import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
  keymap,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { closeBrackets } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import type { IdeEditorTab } from "../store/ideEditorTypes.js";
import type { IdeEditorStateSnapshot } from "./ideEditorStateCache.js";
import { loadIdeLanguageExtension } from "./ideLanguage.js";

export interface IdeEditorSession extends IdeEditorStateSnapshot {
  bom: string;
  compartments: Record<"language" | "theme" | "editable" | "bindings", Compartment>;
  languageStatus: "pending" | "ready" | "failed";
  language: Extension | null;
  onLanguageSettled?: () => void;
  appliedLocationSequence?: number;
  scrollSnapshot?: ReturnType<EditorView["scrollSnapshot"]>;
}

const themes = new Map<boolean, Extension>();
export function ideEditorTheme(dark: boolean): Extension {
  let theme = themes.get(dark);
  if (!theme) {
    theme = EditorView.theme(
      {
        "&": {
          height: "100%",
          color: "var(--color-foreground)",
          backgroundColor: "var(--color-background)",
        },
        ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono, monospace)" },
        ".cm-content": { caretColor: "var(--color-brand)" },
        ".cm-cursor": { borderLeftColor: "var(--color-brand)" },
        ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--color-surface-hover)" },
        ".cm-gutters": {
          backgroundColor: "var(--color-header)",
          color: "var(--color-foreground-subtle)",
          border: "none",
        },
      },
      { dark },
    );
    themes.set(dark, theme);
  }
  return theme;
}

export function ideEditorEditable(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

const commonExtensions: Extension = [
  lineNumbers(),
  drawSelection(),
  foldGutter(),
  history(),
  bracketMatching(),
  closeBrackets(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  indentUnit.of("    "),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
];

export function createIdeEditorSession(
  tab: IdeEditorTab,
  dark: boolean,
  readOnly: boolean,
): IdeEditorSession {
  const bom = tab.draftContent.startsWith("\ufeff") ? "\ufeff" : "";
  const compartments = {
    language: new Compartment(),
    theme: new Compartment(),
    editable: new Compartment(),
    bindings: new Compartment(),
  };
  return {
    path: tab.path,
    instanceId: tab.instanceId,
    docVersion: tab.docVersion,
    content: tab.draftContent,
    bom,
    compartments,
    languageStatus: "pending",
    language: null,
    state: EditorState.create({
      doc: tab.draftContent.slice(bom.length),
      extensions: [
        EditorState.lineSeparator.of(tab.draftContent.match(/\r\n|\n|\r/)?.[0] ?? "\n"),
        commonExtensions,
        compartments.language.of([]),
        compartments.theme.of(ideEditorTheme(dark)),
        compartments.editable.of(ideEditorEditable(readOnly)),
        compartments.bindings.of([]),
      ],
    }),
  };
}

/** 恢复缓存时单独安装语言，其他界面配置不在语言降级的错误边界内。 */
export function restoreIdeEditorSessionLanguage(session: IdeEditorSession): EditorState {
  try {
    return session.state.update({
      effects: session.compartments.language.reconfigure(session.language ?? []),
    }).state;
  } catch {
    // 非活动期间导入完成的扩展到此处才安装，也必须保留纯文本降级语义。
    session.language = null;
    session.languageStatus = "failed";
  }
  return session.state.update({
    effects: session.compartments.language.reconfigure([]),
  }).state;
}

/** 结果只写所属文档；激活者通过通知应用扩展，迟到结果不能写入另一个文件。 */
export async function loadIdeEditorSessionLanguage(
  session: IdeEditorSession,
  load: (path: string) => Promise<Extension | null> = loadIdeLanguageExtension,
): Promise<void> {
  try {
    session.language = await load(session.path);
    session.languageStatus = "ready";
    session.onLanguageSettled?.();
    return;
  } catch {
    // 扩展导入成功后仍可能在实际安装时失败；清除它，恢复纯文本编辑。
    session.language = null;
    session.languageStatus = "failed";
  }
  // 失败通知不在降级 catch 内；通知自身异常需要向调用方传播。
  session.onLanguageSettled?.();
}
