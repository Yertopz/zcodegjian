import type {
  BrowserConsoleDeepCaptureResult,
  BrowserNetworkResponseBodyResult,
} from "@zcode/shared";
import { getBrowserConsoleTab } from "./browserConsoleTabRegistry.js";

/**
 * 深采集的 main 侧入口。
 *
 * 真正的 CDP attach/detach 由 `BrowserGuestManager` 持有（它同时负责崩溃防护与空闲释放），
 * 这里只做租约编排与实例归属校验，并作为模块单例暴露给 IPC。端口由 index.ts 注入。
 */

export interface BrowserConsoleDeepCapturePort {
  acquire(tabId: string): Promise<boolean>;
  release(tabId: string): void;
  getResponseBody(tabId: string, requestId: string): Promise<BrowserNetworkResponseBodyResult>;
  /** 绑定开关切换时更新 console tab 的可认领归属（不重建 guest）。 */
  updateTabBinding?(tabId: string, input: { workspaceKey: string; sessionId: string | null }): void;
  /** 关闭 AI 控制时把已认领的控制台 tab 收回给用户。 */
  releaseClaimedTabs?(instanceId: string): void;
}

let port: BrowserConsoleDeepCapturePort | null = null;

export function setBrowserConsoleDeepCapturePort(next: BrowserConsoleDeepCapturePort | null): void {
  port = next;
}

function tabBelongsToInstance(tabId: string, instanceId: string): boolean {
  const tab = getBrowserConsoleTab(tabId);
  return tab?.instanceId === instanceId;
}

export async function acquireBrowserConsoleDeepCapture(input: {
  instanceId: string;
  tabId: string;
}): Promise<BrowserConsoleDeepCaptureResult> {
  if (!tabBelongsToInstance(input.tabId, input.instanceId)) {
    return { ok: false, error: "not_found" };
  }
  if (!port) return { ok: false, error: "debugger_unavailable" };
  const ok = await port.acquire(input.tabId);
  return ok ? { ok: true } : { ok: false, error: "tab_not_attached" };
}

export function releaseBrowserConsoleDeepCapture(input: { instanceId: string; tabId: string }): {
  ok: boolean;
} {
  if (!tabBelongsToInstance(input.tabId, input.instanceId) || !port) return { ok: false };
  port.release(input.tabId);
  return { ok: true };
}

export async function getBrowserConsoleResponseBody(input: {
  instanceId: string;
  tabId: string;
  requestId: string;
}): Promise<BrowserNetworkResponseBodyResult> {
  if (!tabBelongsToInstance(input.tabId, input.instanceId)) {
    return { ok: false, reason: "标签页不属于该实例" };
  }
  if (!port) return { ok: false, reason: "深采集不可用" };
  return port.getResponseBody(input.tabId, input.requestId);
}

/** 绑定开关切换：把新归属应用到该实例已有 console tab。 */
export function applyBrowserConsoleTabBinding(
  tabId: string,
  input: { workspaceKey: string; sessionId: string | null },
): void {
  port?.updateTabBinding?.(tabId, input);
}

/** 用户关闭「AI 控制此浏览器」时立即收回该实例的已认领 tab。 */
export function releaseBrowserConsoleClaimedTabs(instanceId: string): void {
  port?.releaseClaimedTabs?.(instanceId);
}

/** 仅测试用：隔离模块级端口。 */
export function resetBrowserConsoleDeepCaptureForTest(): void {
  port = null;
}
