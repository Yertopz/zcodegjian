import { z } from "zod";

/**
 * 「AI 控制此浏览器」的显式绑定契约。
 *
 * 绑定按 `windowId + workspaceKey + sessionId` 保存，默认关闭，应用重启后不恢复。
 * 未绑定时 Agent 既看不到控制台 tab（不进入 `user.openTabs()`），也不能认领；
 * 绑定后控制台 tab 变为可认领，且无 tabId 的命令落在该实例的活动标签。
 */

export const browserConsoleSetAgentBindingRequestSchema = z
  .object({
    workspaceKey: z.string().trim().min(1).max(4096),
    sessionId: z.string().trim().min(1).max(256),
    instanceId: z.string().trim().min(1).max(64).nullable(),
  })
  .strict();
export type BrowserConsoleSetAgentBindingRequest = z.infer<
  typeof browserConsoleSetAgentBindingRequestSchema
>;

export const browserConsoleGetAgentBindingRequestSchema = z
  .object({
    workspaceKey: z.string().trim().min(1).max(4096),
    sessionId: z.string().trim().min(1).max(256),
  })
  .strict();
export type BrowserConsoleGetAgentBindingRequest = z.infer<
  typeof browserConsoleGetAgentBindingRequestSchema
>;

export interface BrowserConsoleAgentBindingSnapshot {
  instanceId: string | null;
}

/** main → renderer：绑定被外部清除（例如实例删除）时同步 UI 开关。 */
export interface BrowserConsoleAgentBindingChangedPayload {
  workspaceKey: string;
  sessionId: string;
  instanceId: string | null;
}

export interface BrowserConsoleSetAgentBindingResult {
  ok: boolean;
  error?: "not_found";
}

/** 绑定查询的只读快照；未绑定返回 null。 */
export interface BrowserConsoleAgentBindingLookup {
  instanceId: string | null;
}
