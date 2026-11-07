import { z } from "zod";

/**
 * 浏览器控制台标签契约。
 *
 * 标签的持久化与激活态属于 renderer 的 UI 状态；main 只登记「这个 tabId 属于哪个
 * 实例 / 窗口」，用于两件安全相关的事：
 * 1. `<webview>` attach 前的一次性许可校验（tabId 必须先在 main 登记）；
 * 2. `webRequest` 事件按 webContentsId 回填 tabId 时的归属判定。
 */

export const MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE = 20;

export const browserConsoleTabRegisterRequestSchema = z
  .object({
    tabId: z.string().trim().min(1).max(128),
    instanceId: z.string().trim().min(1).max(64),
  })
  .strict();
export type BrowserConsoleTabRegisterRequest = z.infer<
  typeof browserConsoleTabRegisterRequestSchema
>;

export const browserConsoleTabIdRequestSchema = z
  .object({ tabId: z.string().trim().min(1).max(128) })
  .strict();
export type BrowserConsoleTabIdRequest = z.infer<typeof browserConsoleTabIdRequestSchema>;

export interface BrowserConsoleTabOwner {
  tabId: string;
  instanceId: string;
  windowId: number;
}

export interface BrowserConsoleTabRegisterResult {
  ok: boolean;
  error?: "invalid_input" | "not_found" | "limit_reached" | "tab_conflict";
}

/** 关闭 console tab 时释放归属；对应 guest 由 renderer 卸载后自然销毁。 */
export interface BrowserConsoleTabUnregisterResult {
  ok: boolean;
}

/** main → renderer：已绑定会话的 `newTab` 落在控制台实例。 */
export interface BrowserConsoleOpenTabPayload {
  tabId: string;
  instanceId: string;
  workspaceKey: string;
  sessionId: string;
  remoteSessionId?: string;
}
