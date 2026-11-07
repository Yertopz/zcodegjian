import type {
  BrowserConsoleFormField,
  BrowserConsolePageEdit,
  BrowserConsolePageSnapshot,
} from "@zcode/shared";

/**
 * 页面检查器注入脚本。
 *
 * 所有脚本都在 guest 主世界执行，且用 IIFE 包裹：重复执行不会因顶层 `const` 重声明而失败。
 * 写入后必须回读，只有回读值与期望一致才报告 retained —— React/Vue 受控组件会把直接赋值改回去。
 */

const SHARED_HELPERS = `
const MAX_ELEMENTS = 300;
const FIELD_SELECTOR = 'input,select,textarea,[contenteditable=""],[contenteditable="true"]';
function isVisible(el) {
  if (!(el instanceof Element)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}
function selectorFor(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  const attrs = ["data-testid", "data-test", "data-qa", "name", "role", "aria-label"];
  for (const attr of attrs) {
    const value = el.getAttribute(attr);
    if (value) return el.tagName.toLowerCase() + "[" + attr + "=" + JSON.stringify(value) + "]";
  }
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < 8) {
    const tag = node.tagName.toLowerCase();
    if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
    const parent = node.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const sameTag = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
    parts.unshift(sameTag.length > 1 ? tag + ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")" : tag);
    node = parent;
  }
  return parts.join(" > ");
}
function queryDeep(selector) {
  const visit = (root) => {
    try {
      const direct = root.querySelector(selector);
      if (direct) return direct;
    } catch (error) {
      return null;
    }
    const all = root.querySelectorAll("*");
    for (const el of all) {
      if (el.shadowRoot) {
        const found = visit(el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(document);
}
function collectDeep(selector, limit) {
  const output = [];
  const visit = (root) => {
    for (const el of root.querySelectorAll(selector)) {
      if (output.length >= limit) return;
      output.push(el);
    }
    for (const el of root.querySelectorAll("*")) {
      if (output.length >= limit) return;
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(document);
  return output;
}
function labelFor(el) {
  if (el.labels && el.labels.length > 0) return (el.labels[0].innerText || "").trim();
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const target = document.getElementById(labelledBy);
    if (target) return (target.innerText || "").trim();
  }
  return (el.getAttribute("placeholder") || "").trim();
}
function descriptorFor(el) {
  const attributes = {};
  for (const attr of Array.from(el.attributes)) attributes[attr.name] = attr.value;
  const value = "value" in el && typeof el.value === "string" ? el.value : undefined;
  return {
    selector: selectorFor(el),
    tagName: el.tagName.toLowerCase(),
    text: (el.innerText || el.textContent || "").slice(0, 4000),
    attributes,
    ...(value === undefined ? {} : { value: el.type === "password" ? "••••••" : value }),
    editable: el.isContentEditable || ["input", "textarea", "select"].includes(el.tagName.toLowerCase()),
    visible: isVisible(el),
    ...(el.getRootNode() instanceof ShadowRoot ? { inShadowRoot: true } : {}),
  };
}
function nativeSetValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor && descriptor.set) descriptor.set.call(el, value);
  else el.value = value;
}
function dispatch(el, type) {
  el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
}
function afterFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
`;

export const BROWSER_CONSOLE_PAGE_SNAPSHOT_SCRIPT = `(() => {
${SHARED_HELPERS}
const elements = collectDeep("body *", MAX_ELEMENTS).slice(0, 120).map(descriptorFor);
const fields = collectDeep(FIELD_SELECTOR, MAX_ELEMENTS).map((el) => {
  const tag = el.tagName.toLowerCase();
  const type = tag === "input" ? (el.getAttribute("type") || "text") : tag;
  const rawValue = "value" in el && typeof el.value === "string" ? el.value : (el.textContent || "");
  return {
    selector: selectorFor(el),
    name: el.getAttribute("name") || el.id || "",
    label: labelFor(el),
    type,
    value: type === "password" ? "••••••" : rawValue.slice(0, 2000),
    required: el.required === true || el.getAttribute("aria-required") === "true",
    visible: isVisible(el),
    ...(tag === "select"
      ? { options: Array.from(el.options).map((option) => option.value) }
      : {}),
    ...(type === "password" || el.getAttribute("autocomplete") === "current-password"
      ? { sensitive: true }
      : {}),
  };
});
return { ok: true, url: location.href, title: document.title, elements, forms: fields };
})()`;

export function buildBrowserConsoleApplyEditScript(
  selector: string,
  edit: BrowserConsolePageEdit,
): string {
  return `(() => {
${SHARED_HELPERS}
const selector = ${JSON.stringify(selector)};
const edit = ${JSON.stringify(edit)};
const el = queryDeep(selector);
if (!el) return { ok: false, retained: false, reason: "未找到元素（页面可能已重新渲染）" };
const readBack = () => {
  if (edit.kind === "text") return el.textContent || "";
  if (edit.kind === "value") return "value" in el ? String(el.value) : "";
  if (edit.kind === "html") return el.innerHTML;
  if (edit.kind === "attribute") return el.getAttribute(edit.name) || "";
  if (edit.kind === "style") return el.style.getPropertyValue(edit.name);
  return "";
};
let reason;
const previous = String(readBack()).slice(0, 100_000);
if (edit.kind === "text") {
  el.textContent = edit.value;
} else if (edit.kind === "value") {
  nativeSetValue(el, edit.value);
  dispatch(el, "input");
  dispatch(el, "change");
} else if (edit.kind === "html") {
  try {
    el.innerHTML = edit.value;
  } catch (error) {
    el.textContent = edit.value;
    reason = "页面拒绝 innerHTML（可能是 Trusted Types / CSP），已降级为纯文本";
  }
} else if (edit.kind === "attribute") {
  el.setAttribute(edit.name, edit.value);
} else if (edit.kind === "style") {
  el.style.setProperty(edit.name, edit.value);
}
return afterFrame().then(() => {
  const value = String(readBack());
  const retained = edit.kind === "html"
    ? el.innerHTML.length > 0
    : value.slice(0, 2000) === String(edit.value).slice(0, 2000);
  return {
    ok: retained,
    readBack: value.slice(0, 2000),
    previous,
    retained,
    ...(reason ? { reason } : {}),
    ...(!retained && !reason ? { reason: "页面脚本把值改回去了（可能是受控组件）" } : {}),
  };
});
})()`;
}

export function buildBrowserConsoleFillFormScript(
  values: Record<string, string>,
  onlyVisible: boolean,
): string {
  return `(() => {
${SHARED_HELPERS}
const values = ${JSON.stringify(values)};
const onlyVisible = ${onlyVisible ? "true" : "false"};
const el = collectDeep(FIELD_SELECTOR, MAX_ELEMENTS);
const matched = [];
const unmatched = new Set(Object.keys(values));
for (const field of el) {
  if (onlyVisible && !isVisible(field)) continue;
  const keys = [
    field.getAttribute("name") || "",
    field.id || "",
    labelFor(field),
    field.getAttribute("aria-label") || "",
    field.getAttribute("placeholder") || "",
  ].filter(Boolean);
  const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(values, candidate));
  if (!key) continue;
  unmatched.delete(key);
  const tag = field.tagName.toLowerCase();
  const type = (field.getAttribute("type") || "").toLowerCase();
  const desired = values[key];
  if (type === "checkbox" || type === "radio") {
    const shouldCheck = /^(true|1|on|yes)$/i.test(desired);
    if (field.checked !== shouldCheck) field.click();
  } else if (tag === "select") {
    nativeSetValue(field, desired);
    dispatch(field, "input");
    dispatch(field, "change");
  } else if (field.isContentEditable) {
    field.textContent = desired;
    dispatch(field, "input");
  } else {
    nativeSetValue(field, desired);
    dispatch(field, "input");
    dispatch(field, "change");
  }
  matched.push({ key, field, type, desired });
}
return afterFrame().then(() => {
  const applied = [];
  const rejected = [];
  for (const entry of matched) {
    if (entry.type === "checkbox" || entry.type === "radio") {
      const shouldCheck = /^(true|1|on|yes)$/i.test(entry.desired);
      if (entry.field.checked === shouldCheck) applied.push(entry.key);
      else rejected.push(entry.key);
      continue;
    }
    const current = entry.field.isContentEditable
      ? (entry.field.textContent || "")
      : String(entry.field.value ?? "");
    if (current === entry.desired) applied.push(entry.key);
    else rejected.push(entry.key);
  }
  return {
    ok: rejected.length === 0 && unmatched.size === 0,
    applied,
    notApplied: [...unmatched],
    rejected,
    ...(rejected.length > 0 ? { reason: "部分字段被页面脚本改回（可能是受控组件）" } : {}),
  };
});
})()`;
}

export const BROWSER_CONSOLE_PICK_ELEMENT_SCRIPT = `(() => {
${SHARED_HELPERS}
if (window.__zcodeConsolePicker) {
  window.__zcodeConsolePicker.cancel();
}
return new Promise((resolve) => {
  const overlay = document.createElement("div");
  overlay.setAttribute("data-zcode-console-picker", "overlay");
  overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;background:rgba(59,130,246,0.12);border-radius:2px;transition:all 40ms linear;";
  let current = null;
  const move = (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const target = path.find((node) => node instanceof Element) || event.target;
    if (!(target instanceof Element)) return;
    current = target;
    const rect = target.getBoundingClientRect();
    overlay.style.left = rect.left + "px";
    overlay.style.top = rect.top + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
  };
  const cleanup = () => {
    window.removeEventListener("mousemove", move, true);
    window.removeEventListener("click", click, true);
    window.removeEventListener("keydown", key, true);
    overlay.remove();
    window.__zcodeConsolePicker = null;
  };
  const click = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = current;
    cleanup();
    if (!target) { resolve({ status: "cancelled" }); return; }
    resolve({ status: "picked", element: descriptorFor(target) });
  };
  const key = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cleanup();
    resolve({ status: "cancelled" });
  };
  window.__zcodeConsolePicker = { cancel: () => { cleanup(); resolve({ status: "cancelled" }); } };
  window.addEventListener("mousemove", move, true);
  window.addEventListener("click", click, true);
  window.addEventListener("keydown", key, true);
  document.documentElement.appendChild(overlay);
});
})()`;

export const BROWSER_CONSOLE_CANCEL_PICK_SCRIPT = `(() => {
  if (window.__zcodeConsolePicker) window.__zcodeConsolePicker.cancel();
  return true;
})()`;

export type BrowserConsoleSnapshotScriptResult = BrowserConsolePageSnapshot;
export type BrowserConsoleFormFieldResult = BrowserConsoleFormField;
