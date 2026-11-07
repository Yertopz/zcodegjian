import { useCallback } from "react";
import type { BrowserConsolePageEdit, BrowserConsolePageSnapshot } from "@zcode/shared";
import { logger } from "@/logger.js";
import {
  BROWSER_CONSOLE_PAGE_SNAPSHOT_SCRIPT,
  BROWSER_CONSOLE_PICK_ELEMENT_SCRIPT,
  buildBrowserConsoleApplyEditScript,
  buildBrowserConsoleFillFormScript,
} from "@/browser-console/inspectorScript.js";
import type { BrowserConsoleTab } from "@/browser-console/browserConsoleTypes.js";

/**
 * 页面检查器执行层：只负责在 guest 主世界跑脚本并把结果按契约返回。
 * 写入是否生效以脚本回读为准，不把「执行未抛错」当成成功。
 */
export function useBrowserConsoleInspector(input: {
  activeTab: BrowserConsoleTab | null;
  getWebview: (tabId: string) => ElectronWebviewTag | undefined;
}): {
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
} {
  const { activeTab, getWebview } = input;
  const executeJavaScript = useCallback(
    async (script: string): Promise<unknown> => {
      if (!activeTab) return null;
      const webview = getWebview(activeTab.id);
      if (!webview) return null;
      try {
        return await webview.executeJavaScript(script, true);
      } catch (cause) {
        logger.warn("[browser-console] executeJavaScript failed", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        return null;
      }
    },
    [activeTab, getWebview],
  );

  const pageSnapshot = useCallback(async (): Promise<BrowserConsolePageSnapshot> => {
    const result = await executeJavaScript(BROWSER_CONSOLE_PAGE_SNAPSHOT_SCRIPT);
    if (result && typeof result === "object") return result as BrowserConsolePageSnapshot;
    return { ok: false, reason: "页面尚未就绪或不允许执行脚本" };
  }, [executeJavaScript]);

  const pickElement = useCallback(
    () => executeJavaScript(BROWSER_CONSOLE_PICK_ELEMENT_SCRIPT),
    [executeJavaScript],
  );

  const applyEdit = useCallback(
    async (selector: string, edit: BrowserConsolePageEdit) => {
      const result = await executeJavaScript(buildBrowserConsoleApplyEditScript(selector, edit));
      if (result && typeof result === "object") {
        return result as {
          ok: boolean;
          retained: boolean;
          reason?: string;
          readBack?: string;
          previous?: string;
        };
      }
      return { ok: false, retained: false, reason: "页面不允许执行脚本" };
    },
    [executeJavaScript],
  );

  const fillForm = useCallback(
    async (values: Record<string, string>, onlyVisible: boolean) => {
      const result = await executeJavaScript(
        buildBrowserConsoleFillFormScript(values, onlyVisible),
      );
      if (result && typeof result === "object") {
        return result as {
          ok: boolean;
          applied: string[];
          notApplied: string[];
          rejected: string[];
          reason?: string;
        };
      }
      return {
        ok: false,
        applied: [],
        notApplied: Object.keys(values),
        rejected: [],
        reason: "页面不允许执行脚本",
      };
    },
    [executeJavaScript],
  );

  return { pageSnapshot, pickElement, applyEdit, fillForm };
}
