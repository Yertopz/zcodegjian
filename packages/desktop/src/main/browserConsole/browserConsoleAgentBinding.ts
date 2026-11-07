/**
 * 「AI 控制此浏览器」显式绑定。
 *
 * 唯一所有者是 main：按 `windowId + workspaceKey + sessionId` 保存。
 * - 默认关闭，应用重启后不恢复（只存内存）。
 * - 未绑定：控制台 tab 的 `claimable=false`，Agent 的 `user.openTabs()` 看不到它们。
 * - 绑定后：该会话的 `newTab` 落到绑定实例，且可认领该实例的 console tab。
 */

export interface BrowserConsoleAgentBinding {
  windowId: number;
  workspaceKey: string;
  sessionId: string;
  instanceId: string;
}

const bindings = new Map<string, BrowserConsoleAgentBinding>();

function keyFor(input: { windowId: number; workspaceKey: string; sessionId: string }): string {
  return `${input.windowId}\u0000${input.workspaceKey}\u0000${input.sessionId}`;
}

export function setBrowserConsoleAgentBinding(input: {
  windowId: number;
  workspaceKey: string;
  sessionId: string;
  instanceId: string | null;
}): void {
  const key = keyFor(input);
  if (input.instanceId === null) {
    bindings.delete(key);
    return;
  }
  bindings.set(key, {
    windowId: input.windowId,
    workspaceKey: input.workspaceKey,
    sessionId: input.sessionId,
    instanceId: input.instanceId,
  });
}

export function getBrowserConsoleAgentBinding(input: {
  windowId: number;
  workspaceKey: string;
  sessionId: string;
}): BrowserConsoleAgentBinding | undefined {
  return bindings.get(keyFor(input));
}

/** index.ts 在 `onOpenTabRequested` 时用 owner 事实反查绑定。 */
export function getBrowserConsoleAgentBindingForSession(input: {
  windowId: number;
  workspaceKey: string;
  sessionId: string;
}): BrowserConsoleAgentBinding | undefined {
  return getBrowserConsoleAgentBinding(input);
}

export function listBrowserConsoleAgentBindings(): BrowserConsoleAgentBinding[] {
  return [...bindings.values()];
}

export function clearBrowserConsoleAgentBindingsForInstance(instanceId: string): void {
  for (const [key, binding] of bindings) {
    if (binding.instanceId === instanceId) bindings.delete(key);
  }
}

export function clearBrowserConsoleAgentBindingsForWindow(windowId: number): void {
  for (const [key, binding] of bindings) {
    if (binding.windowId === windowId) bindings.delete(key);
  }
}

/** 仅测试用：隔离模块级状态。 */
export function resetBrowserConsoleAgentBindingsForTest(): void {
  bindings.clear();
}
