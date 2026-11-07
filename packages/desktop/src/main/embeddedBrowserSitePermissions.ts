import { DEFAULT_BROWSER_INSTANCE_PARTITION } from "@zcode/shared";
import type {
  EmbeddedBrowserSitePermissionRecord,
  EmbeddedBrowserSitePermissionStore,
  EmbeddedBrowserSitePermissionStoreRecords,
} from "./embeddedBrowserPermissionPolicy.js";

/**
 * 内置浏览器站点同意记录的模块级管理器（按 partition 隔离）。
 *
 * - permission check/request handler 需要同步读取（Electron check handler 无异步版），
 *   因此记录常驻内存，持久化（store）在写路径异步落盘；
 * - 设置页「网站权限」与「清除浏览器数据」经同一模块读写默认 partition，语义与迁移前一致；
 * - 控制台实例读写自己的 partition，一个实例的授权不会泄漏到另一个实例。
 */
let records: EmbeddedBrowserSitePermissionStoreRecords = {};
let store: EmbeddedBrowserSitePermissionStore | null = null;
let logger: { warn: (...args: unknown[]) => void } | null = null;

export async function initEmbeddedBrowserSitePermissions(input: {
  store?: EmbeddedBrowserSitePermissionStore;
  logger: { warn: (...args: unknown[]) => void };
}): Promise<void> {
  store = input.store ?? null;
  logger = input.logger;
  records = {};
  if (store) {
    try {
      records = await store.load();
    } catch (error) {
      input.logger.warn("[embedded-browser-permission] site permission store load failed:", error);
    }
  }
}

export function getEmbeddedBrowserSitePermission(
  origin: string,
  permission: string,
  partition: string = DEFAULT_BROWSER_INSTANCE_PARTITION,
): "allow" | "deny" | undefined {
  return records[partition]?.[origin]?.[permission];
}

export function getEmbeddedBrowserSitePermissionSnapshot(
  partition: string = DEFAULT_BROWSER_INSTANCE_PARTITION,
): EmbeddedBrowserSitePermissionRecord {
  return structuredClone(records[partition] ?? {});
}

export async function writeEmbeddedBrowserSitePermission(
  origin: string,
  permission: string,
  state: "allow" | "deny",
  partition: string = DEFAULT_BROWSER_INSTANCE_PARTITION,
): Promise<void> {
  const current = records[partition] ?? {};
  records[partition] = { ...current, [origin]: { ...current[origin], [permission]: state } };
  await persist();
}

/** state 传 "ask" 表示删除该条记录（回到每次询问）。 */
export async function removeEmbeddedBrowserSitePermission(
  origin: string,
  permission: string,
  partition: string = DEFAULT_BROWSER_INSTANCE_PARTITION,
): Promise<void> {
  const permissions = records[partition]?.[origin];
  if (!permissions) return;
  const next = { ...permissions };
  delete next[permission];
  const partitionRecord = { ...records[partition] };
  if (Object.keys(next).length === 0) delete partitionRecord[origin];
  else partitionRecord[origin] = next;
  records[partition] = partitionRecord;
  await persist();
}

export async function removeEmbeddedBrowserSitePermissionOrigin(
  origin: string,
  partition: string = DEFAULT_BROWSER_INSTANCE_PARTITION,
): Promise<void> {
  const partitionRecord = records[partition];
  if (!partitionRecord) return;
  const next = { ...partitionRecord };
  delete next[origin];
  records[partition] = next;
  await persist();
}

export async function clearEmbeddedBrowserSitePermissions(
  partition: string = DEFAULT_BROWSER_INSTANCE_PARTITION,
): Promise<void> {
  records[partition] = {};
  await persist();
}

/** 实例删除联动清理：整段 partition 记录删除，不触碰默认实例。 */
export async function removeEmbeddedBrowserSitePermissionsForPartition(
  partition: string,
): Promise<void> {
  delete records[partition];
  await persist();
}

async function persist(): Promise<void> {
  if (!store) return;
  try {
    await store.persist(records);
  } catch (error) {
    // 内存记录已生效，落盘失败只降级为重启后回退到「每次询问」，不阻塞决策。
    logger?.warn("[embedded-browser-permission] site permission store persist failed:", error);
  }
}

/** 仅测试用：隔离模块级状态。 */
export function resetEmbeddedBrowserSitePermissionsForTest(): void {
  records = {};
  store = null;
  logger = null;
}
