import { useCallback, useEffect, useState } from "react";
import type {
  BrowserConsoleElementDescriptor,
  BrowserConsolePageEdit,
  BrowserConsolePageSnapshot,
} from "@zcode/shared";
import { ClipboardCopy, Crosshair, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { FormFieldRow, buildAiContext } from "@/browser-console/pageInspectorParts.js";

export function PageInspector({
  pageSnapshot,
  pickElement,
  applyEdit,
  fillForm,
  formOnly = false,
  tabId,
}: {
  pageSnapshot: () => Promise<BrowserConsolePageSnapshot>;
  pickElement: () => Promise<unknown>;
  applyEdit: (
    selector: string,
    edit: BrowserConsolePageEdit,
  ) => Promise<{
    ok: boolean;
    retained: boolean;
    reason?: string;
    readBack?: string;
    previous?: string;
  }>;
  fillForm: (
    values: Record<string, string>,
    onlyVisible: boolean,
  ) => Promise<{
    ok: boolean;
    applied: string[];
    notApplied: string[];
    rejected: string[];
    reason?: string;
  }>;
  /** 只展示表单字段与填充，不展示元素拾取/编辑。 */
  formOnly?: boolean;
  /** 标签切换即清空撤销栈（导航/刷新后旧选择器已不可靠）。 */
  tabId?: string | null;
}): React.JSX.Element {
  const { intl } = useZCodeIntl();
  const [snapshot, setSnapshot] = useState<BrowserConsolePageSnapshot | null>(null);
  const [picked, setPicked] = useState<BrowserConsoleElementDescriptor | null>(null);
  const [picking, setPicking] = useState(false);
  const [textValue, setTextValue] = useState("");
  const [htmlValue, setHtmlValue] = useState("");
  const [attributeName, setAttributeName] = useState("");
  const [attributeValue, setAttributeValue] = useState("");
  const [styleName, setStyleName] = useState("");
  const [styleValue, setStyleValue] = useState("");
  const [jsonValues, setJsonValues] = useState("");
  const [onlyVisible, setOnlyVisible] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<
    { selector: string; edit: BrowserConsolePageEdit; label: string }[]
  >([]);

  useEffect(() => {
    setUndoStack([]);
  }, [tabId]);

  const refresh = useCallback(async () => {
    const next = await pageSnapshot();
    setSnapshot(next);
    if (!next.ok && next.reason) setError(next.reason);
  }, [pageSnapshot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pick = async () => {
    setPicking(true);
    setError(null);
    try {
      const result = (await pickElement()) as
        | { status: "picked"; element: BrowserConsoleElementDescriptor }
        | { status: "cancelled" }
        | { status: "unsupported"; reason: string }
        | null;
      if (!result) {
        setError(intl.formatMessage({ id: "browserConsole.pageNotReady" }));
        return;
      }
      if (result.status === "picked") {
        setPicked(result.element);
        setTextValue(result.element.text);
        setHtmlValue("");
      } else if (result.status === "unsupported") {
        setError(result.reason);
      }
    } finally {
      setPicking(false);
    }
  };

  const runEdit = async (edit: BrowserConsolePageEdit) => {
    if (!picked) return;
    setStatus(null);
    setError(null);
    const result = await applyEdit(picked.selector, edit);
    if (result.retained) {
      setStatus(intl.formatMessage({ id: "browserConsole.editApplied" }));
      pushUndo(picked.selector, edit, result.previous);
    } else {
      setError(result.reason ?? intl.formatMessage({ id: "browserConsole.editRejected" }));
    }
    await refresh();
  };

  const pushUndo = (
    selector: string,
    edit: BrowserConsolePageEdit,
    previous: string | undefined,
  ) => {
    if (previous === undefined) return;
    const inverse: BrowserConsolePageEdit =
      edit.kind === "attribute" || edit.kind === "style"
        ? { kind: edit.kind, name: edit.name, value: previous }
        : { kind: edit.kind, value: previous };
    setUndoStack((current) =>
      [...current, { selector, edit: inverse, label: `${edit.kind} ${selector}` }].slice(-20),
    );
  };

  const undoLast = async () => {
    const last = undoStack.at(-1);
    if (!last) {
      setError(intl.formatMessage({ id: "browserConsole.nothingToUndo" }));
      return;
    }
    setStatus(null);
    setError(null);
    const result = await applyEdit(last.selector, last.edit);
    setUndoStack((current) => current.slice(0, -1));
    if (result.retained) setStatus(intl.formatMessage({ id: "browserConsole.undoApplied" }));
    else setError(result.reason ?? intl.formatMessage({ id: "browserConsole.editRejected" }));
    await refresh();
  };

  const runFill = async () => {
    setStatus(null);
    setError(null);
    let parsed: Record<string, string>;
    try {
      const value = JSON.parse(jsonValues || "{}") as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("not object");
      parsed = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)]),
      );
    } catch {
      setError(intl.formatMessage({ id: "browserConsole.invalidJson" }));
      return;
    }
    if (Object.keys(parsed).length === 0) {
      setError(intl.formatMessage({ id: "browserConsole.emptyJson" }));
      return;
    }
    const result = await fillForm(parsed, onlyVisible);
    if (result.rejected.length > 0) {
      setError(
        intl.formatMessage(
          { id: "browserConsole.fillRejected" },
          { fields: result.rejected.join(", ") },
        ),
      );
    }
    if (result.notApplied.length > 0) {
      setError(
        intl.formatMessage(
          { id: "browserConsole.fillNotApplied" },
          { fields: result.notApplied.join(", ") },
        ),
      );
    }
    if (result.ok) setStatus(intl.formatMessage({ id: "browserConsole.fillApplied" }));
    await refresh();
  };

  const aiContext = buildAiContext(snapshot);
  const copyAiContext = async () => {
    try {
      await navigator.clipboard.writeText(aiContext);
      setStatus(intl.formatMessage({ id: "browserConsole.aiContextCopied" }));
    } catch {
      setError(intl.formatMessage({ id: "browserConsole.clipboardFailed" }));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto px-2 py-2 text-ui-base">
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          <RefreshCw className="size-3.5" />
          {intl.formatMessage({ id: "browserConsole.refreshSnapshot" })}
        </Button>
        {formOnly ? null : (
          <Button
            size="sm"
            variant={picking ? "secondary" : "outline"}
            disabled={picking}
            onClick={() => void pick()}
          >
            <Crosshair className="size-3.5" />
            {intl.formatMessage({ id: "browserConsole.pickElement" })}
          </Button>
        )}
        {formOnly ? null : (
          <Button
            size="sm"
            variant="ghost"
            disabled={undoStack.length === 0}
            onClick={() => void undoLast()}
          >
            <Undo2 className="size-3.5" />
            {intl.formatMessage({ id: "browserConsole.undo" })} ({undoStack.length})
          </Button>
        )}
      </div>
      <p className="mt-1 text-ui-xs text-foreground-subtle">
        {intl.formatMessage({ id: "browserConsole.inspectorLimits" })}
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded bg-destructive/10 px-2 py-1 text-ui-base text-destructive"
        >
          {error}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="mt-2 rounded bg-surface px-2 py-1 text-ui-base text-foreground">
          {status}
        </p>
      ) : null}

      {picked && !formOnly ? (
        <section className="mt-3 flex flex-col gap-2">
          <div className="rounded border border-border-subtle bg-surface p-2 font-mono text-ui-xs">
            <div className="break-all text-foreground-subtle">{picked.selector}</div>
            <div className="mt-1">
              &lt;{picked.tagName}&gt; {picked.inShadowRoot ? "(shadow root)" : ""}
            </div>
            <div className="mt-1 line-clamp-3 whitespace-pre-wrap">{picked.text}</div>
          </div>
          <div className="flex gap-1">
            <Input
              value={textValue}
              onChange={(event) => setTextValue(event.currentTarget.value)}
            />
            <Button size="sm" onClick={() => void runEdit({ kind: "text", value: textValue })}>
              {intl.formatMessage({ id: "browserConsole.applyText" })}
            </Button>
          </div>
          <div className="flex gap-1">
            <Input
              value={attributeName}
              placeholder={intl.formatMessage({ id: "browserConsole.attributeName" })}
              onChange={(event) => setAttributeName(event.currentTarget.value)}
            />
            <Input
              value={attributeValue}
              placeholder={intl.formatMessage({ id: "browserConsole.attributeValue" })}
              onChange={(event) => setAttributeValue(event.currentTarget.value)}
            />
            <Button
              size="sm"
              disabled={!attributeName.trim()}
              onClick={() =>
                void runEdit({
                  kind: "attribute",
                  name: attributeName.trim(),
                  value: attributeValue,
                })
              }
            >
              {intl.formatMessage({ id: "browserConsole.apply" })}
            </Button>
          </div>
          <div className="flex gap-1">
            <Input
              value={styleName}
              placeholder="color / display"
              onChange={(event) => setStyleName(event.currentTarget.value)}
            />
            <Input
              value={styleValue}
              placeholder="#333 / none"
              onChange={(event) => setStyleValue(event.currentTarget.value)}
            />
            <Button
              size="sm"
              disabled={!styleName.trim()}
              onClick={() =>
                void runEdit({ kind: "style", name: styleName.trim(), value: styleValue })
              }
            >
              {intl.formatMessage({ id: "browserConsole.apply" })}
            </Button>
          </div>
          <textarea
            value={htmlValue}
            onChange={(event) => setHtmlValue(event.currentTarget.value)}
            rows={3}
            placeholder={intl.formatMessage({ id: "browserConsole.htmlHint" })}
            className="w-full rounded-md border border-input-border bg-input p-2 font-mono text-ui-xs"
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={!htmlValue}
            onClick={() => {
              if (!window.confirm(intl.formatMessage({ id: "browserConsole.htmlConfirm" }))) return;
              void runEdit({ kind: "html", value: htmlValue });
            }}
          >
            {intl.formatMessage({ id: "browserConsole.applyHtml" })}
          </Button>
        </section>
      ) : null}

      <section className="mt-4">
        <h3 className="mb-1 font-medium text-foreground">
          {intl.formatMessage({ id: "browserConsole.formFields" })}
        </h3>
        {snapshot?.forms && snapshot.forms.length > 0 ? (
          <ul className="flex flex-col gap-0.5">
            {snapshot.forms.map((field) => (
              <FormFieldRow key={`${field.selector}-${field.name}`} field={field} />
            ))}
          </ul>
        ) : (
          <p className="text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: "browserConsole.noFormFields" })}
          </p>
        )}
      </section>

      <section className="mt-3 flex flex-col gap-1">
        <h3 className="font-medium text-foreground">
          {intl.formatMessage({ id: "browserConsole.fillForm" })}
        </h3>
        <textarea
          value={jsonValues}
          onChange={(event) => setJsonValues(event.currentTarget.value)}
          rows={4}
          placeholder={'{\n  "email": "a@b.com"\n}'}
          className="w-full rounded-md border border-input-border bg-input p-2 font-mono text-ui-xs"
        />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-ui-xs text-foreground-subtle">
            <input
              type="checkbox"
              checked={onlyVisible}
              onChange={(event) => setOnlyVisible(event.currentTarget.checked)}
            />
            {intl.formatMessage({ id: "browserConsole.onlyVisible" })}
          </label>
          <Button size="sm" onClick={() => void runFill()}>
            {intl.formatMessage({ id: "browserConsole.fill" })}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void copyAiContext()}>
            <ClipboardCopy className="size-3.5" />
            {intl.formatMessage({ id: "browserConsole.copyAiContext" })}
          </Button>
        </div>
        <p className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "browserConsole.aiContextHint" })}
        </p>
      </section>
    </div>
  );
}
