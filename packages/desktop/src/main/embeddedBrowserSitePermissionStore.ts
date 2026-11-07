// Modified by ZCode: 搬自上游 zai-org/ZCode aac47556 (Apache-2.0)；内置浏览器权限治理(F9),与上游一致,仅随本仓 shared 通道名。
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_BROWSER_INSTANCE_PARTITION } from "@zcode/shared";
import type {
  EmbeddedBrowserSitePermissionRecord,
  EmbeddedBrowserSitePermissionStore,
  EmbeddedBrowserSitePermissionStoreRecords,
} from "./embeddedBrowserPermissionPolicy.js";

/**
 * 内置浏览器站点同意记录的文件持久化：userData 下独立 JSON，原子写（tmp + rename）。
 *
 * v2 结构：`{ version: 2, partitions: { [partition]: { [origin]: { [permission]: ... } } } }`。
 * 迁移前的扁平结构（origin 直接在顶层）加载时归入默认实例 partition，不丢用户已做的决定。
 * 结构损坏时按空记录重启（fail-open 到「每次询问」，不会错误放行）。
 */
const STORE_VERSION = 2;

export function createEmbeddedBrowserSitePermissionStore(
  filePath: string,
): EmbeddedBrowserSitePermissionStore {
  const tempPath = join(
    dirname(filePath),
    `.${Math.random().toString(36).slice(2)}-site-permissions.tmp`,
  );

  const parseOriginRecord = (value: unknown): EmbeddedBrowserSitePermissionRecord => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const record: EmbeddedBrowserSitePermissionRecord = {};
    for (const [origin, permissions] of Object.entries(value as Record<string, unknown>)) {
      if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) continue;
      const normalized: Record<string, "allow" | "deny"> = {};
      for (const [permission, state] of Object.entries(permissions as Record<string, unknown>)) {
        if (state === "allow" || state === "deny") normalized[permission] = state;
      }
      if (Object.keys(normalized).length > 0) record[origin] = normalized;
    }
    return record;
  };

  const parseStoreRecords = (raw: string): EmbeddedBrowserSitePermissionStoreRecords => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version === STORE_VERSION && candidate.partitions) {
      const partitions: EmbeddedBrowserSitePermissionStoreRecords = {};
      for (const [partition, value] of Object.entries(
        candidate.partitions as Record<string, unknown>,
      )) {
        const record = parseOriginRecord(value);
        if (Object.keys(record).length > 0) partitions[partition] = record;
      }
      return partitions;
    }
    // 旧扁平结构：顶层就是 origin → permission → state。
    const legacy = parseOriginRecord(candidate);
    return Object.keys(legacy).length > 0
      ? { [DEFAULT_BROWSER_INSTANCE_PARTITION]: legacy }
      : {};
  };

  return {
    async load() {
      try {
        return parseStoreRecords(await readFile(filePath, "utf8"));
      } catch {
        return {};
      }
    },
    async persist(records) {
      try {
        await mkdir(dirname(filePath), { recursive: true });
        const payload = { version: STORE_VERSION, partitions: records };
        await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        await rename(tempPath, filePath);
      } catch {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw new Error(`failed to persist embedded browser site permissions: ${filePath}`);
      }
    },
  };
}
