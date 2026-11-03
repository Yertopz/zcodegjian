import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { BROWSER_INSTANCE_PARTITION_PREFIX } from "@zcode/shared";

/**
 * 启动时清理孤儿 partition 目录。
 *
 * Chromium 在运行期持有分区句柄，删除实例时只能清数据、不能删目录；下次启动在
 * 任何 Session 创建之前扫描 `userData/Partitions`，把注册表已无记录的实例目录删除。
 * 清理失败只告警，不阻断启动。
 */
export async function cleanupBrowserConsoleOrphanPartitions(input: {
  userDataPath: string;
  activePartitions: ReadonlySet<string>;
  logger: { warn: (...args: unknown[]) => void };
}): Promise<string[]> {
  const partitionsDir = join(input.userDataPath, "Partitions");
  const entries = await readdir(partitionsDir, { withFileTypes: true }).catch(() => []);
  const removed: string[] = [];
  const prefix = BROWSER_INSTANCE_PARTITION_PREFIX.slice("persist:".length);
  for (const entry of entries) {
    const name = String(entry.name);
    if (!entry.isDirectory() || !name.startsWith(prefix)) continue;
    // Electron 的分区目录名去掉 `persist:` 前缀。
    const partition = `persist:${name}`;
    if (input.activePartitions.has(partition)) continue;
    try {
      await rm(join(partitionsDir, name), { recursive: true, force: true });
      removed.push(name);
      input.logger.warn(`[browser-console] orphan partition removed name=${name}`);
    } catch (error) {
      input.logger.warn(`[browser-console] orphan partition cleanup failed name=${name}`, error);
    }
  }
  return removed;
}
