import type { BrowserConsoleFormField, BrowserConsolePageSnapshot } from "@zcode/shared";

export function FormFieldRow({ field }: { field: BrowserConsoleFormField }): React.JSX.Element {
  return (
    <li className="flex items-center gap-1 truncate text-ui-xs">
      <span className="w-24 shrink-0 truncate text-foreground-subtle">
        {field.label || field.name}
      </span>
      <span className="w-12 shrink-0 text-foreground-subtle">{field.type}</span>
      <span className="truncate font-mono">{field.sensitive ? "••••••" : field.value}</span>
      {field.required ? <span className="text-destructive">*</span> : null}
      {field.visible ? null : <span className="text-foreground-subtlest">(hidden)</span>}
    </li>
  );
}

/** 生成可粘贴到对话的填写上下文；密码字段不进入上下文。 */
export function buildAiContext(snapshot: BrowserConsolePageSnapshot | null): string {
  if (!snapshot?.ok) return "";
  const fields = (snapshot.forms ?? [])
    .filter((field) => !field.sensitive)
    .map((field) => `- ${field.name || field.label} (${field.type}): ${field.value}`)
    .join("\n");
  return [
    `页面：${snapshot.title ?? ""}`,
    `URL：${snapshot.url ?? ""}`,
    "表单字段（密码字段已省略）：",
    fields || "（没有可填写的字段）",
    "",
    "请用 browser 的 fill/select/check 命令填写，不要修改页面结构。",
  ].join("\n");
}
