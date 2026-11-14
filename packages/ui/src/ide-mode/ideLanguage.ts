import type { Extension } from "@codemirror/state";

/** 使用明确的语言工厂；LanguageSupport 自身就是扩展，不存在 .default。 */
export async function loadIdeLanguageExtension(path: string): Promise<Extension | null> {
  const ext = path.split(/[\\/]/).pop()?.split(".").slice(1).pop()?.toLowerCase();
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
    case "ts":
    case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({
        jsx: ext === "jsx" || ext === "tsx",
        typescript: ext === "ts" || ext === "tsx",
      });
    }
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "html":
    case "htm":
      return (await import("@codemirror/lang-html")).html();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "md":
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "py":
      return (await import("@codemirror/lang-python")).python();
    default:
      return null;
  }
}
