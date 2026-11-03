import { isBrowserConsolePartition } from "@zcode/shared";

/**
 * 控制台实例 partition 的 attach 白名单与一次性许可。
 *
 * 为什么需要许可：`will-attach-webview` 触发时 main 只知道 partition，不知道 renderer
 * 要挂哪个 tab。只按 partition 放行会让被攻陷的 renderer 用 A 实例的 partition 加载
 * B 实例的页面（Cookie/代理串台）。renderer 必须在创建 `<webview>` 前先经 IPC 登记
 * `(windowId, partition)`，attach 时消费一次；没有许可的控制台 partition 一律拒绝。
 */

const PENDING_TTL_MS = 30_000;
const MAX_PENDING_PER_WINDOW = 32;

interface PendingAttach {
  count: number;
  expiresAt: number;
}

const registeredPartitions = new Set<string>();
const pendingByWindow = new Map<number, Map<string, PendingAttach>>();

function keyFor(windowId: number, partition: string): string {
  return `${windowId}\u0000${partition}`;
}

function pruneExpired(windowId: number, now: number): void {
  const pending = pendingByWindow.get(windowId);
  if (!pending) return;
  for (const [partition, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(partition);
  }
  if (pending.size === 0) pendingByWindow.delete(windowId);
}

export function registerBrowserConsolePartition(partition: string): void {
  if (isBrowserConsolePartition(partition)) {
    registeredPartitions.add(partition);
  }
}

export function unregisterBrowserConsolePartition(partition: string): void {
  registeredPartitions.delete(partition);
}

export function isRegisteredBrowserConsolePartition(partition: string | undefined): boolean {
  return typeof partition === "string" && registeredPartitions.has(partition);
}

/**
 * 登记一次即将发生的控制台 guest attach。
 *
 * 同实例多 tab 并发 attach 时按 partition 计数，不要求与某个 tabId 一一对应；
 * tabId 与 guest 的一致性由随后 `BrowserGuestManager.attachGuest` 的 owner 校验负责。
 */
export function prepareBrowserConsoleGuestAttach(input: {
  windowId: number;
  partition: string;
  now?: number;
}): boolean {
  if (!registeredPartitions.has(input.partition)) return false;
  const now = input.now ?? Date.now();
  pruneExpired(input.windowId, now);
  let pending = pendingByWindow.get(input.windowId);
  if (!pending) {
    pending = new Map();
    pendingByWindow.set(input.windowId, pending);
  }
  let total = 0;
  for (const entry of pending.values()) total += entry.count;
  if (total >= MAX_PENDING_PER_WINDOW) return false;
  const key = keyFor(input.windowId, input.partition);
  const existing = pending.get(key);
  pending.set(key, {
    count: (existing?.count ?? 0) + 1,
    expiresAt: now + PENDING_TTL_MS,
  });
  return true;
}

/** 消费一次 attach 许可；过期、未登记或已用完都返回 false。 */
export function consumeBrowserConsoleGuestAttach(input: {
  windowId: number;
  partition: string;
  now?: number;
}): boolean {
  if (!registeredPartitions.has(input.partition)) return false;
  const now = input.now ?? Date.now();
  pruneExpired(input.windowId, now);
  const pending = pendingByWindow.get(input.windowId);
  if (!pending) return false;
  const key = keyFor(input.windowId, input.partition);
  const entry = pending.get(key);
  if (!entry || entry.count <= 0 || entry.expiresAt <= now) {
    pending.delete(key);
    return false;
  }
  if (entry.count <= 1) pending.delete(key);
  else pending.set(key, { count: entry.count - 1, expiresAt: entry.expiresAt });
  if (pending.size === 0) pendingByWindow.delete(input.windowId);
  return true;
}

/** 仅测试用：隔离模块级状态。 */
export function resetBrowserConsolePartitionGuardForTest(): void {
  registeredPartitions.clear();
  pendingByWindow.clear();
}

export const BROWSER_CONSOLE_ATTACH_PENDING_TTL_MS = PENDING_TTL_MS;
