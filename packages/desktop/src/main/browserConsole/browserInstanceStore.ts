import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  DEFAULT_BROWSER_INSTANCE_ID,
  DEFAULT_BROWSER_INSTANCE_PARTITION,
  MAX_BROWSER_INSTANCES,
  browserInstancePartitionForId,
  browserInstanceRecordSchema,
  type BrowserConsoleErrorCode,
  type BrowserInstanceCreateRequest,
  type BrowserInstanceRecord,
  type BrowserInstanceUpdateRequest,
} from "@zcode/shared";

/**
 * 浏览器控制台实例注册表。
 *
 * 唯一所有者：本模块持有实例记录的内存副本并负责原子落盘。Session / 代理 / 权限都是
 * 由记录派生出的运行时投影，不反向写回记录。持久化结构带 version，便于后续迁移
 * （例如站点权限按 partition 隔离、代理凭据字段）。
 */

const STORE_VERSION = 1;

const storeFileSchema = z
  .object({
    version: z.literal(STORE_VERSION),
    instances: z.array(browserInstanceRecordSchema),
  })
  .strict();

export type BrowserInstanceStoreErrorCode =
  | "not_found"
  | "default_immutable"
  | "limit_reached"
  | "persist_failed"
  | "invalid_record";

export class BrowserInstanceStoreError extends Error {
  readonly code: BrowserInstanceStoreErrorCode;

  constructor(code: BrowserInstanceStoreErrorCode, message?: string) {
    super(message ?? code);
    this.name = "BrowserInstanceStoreError";
    this.code = code;
  }
}

/** 注册表错误 → 控制台 IPC 错误码；运行时与单测共用同一映射。 */
export function mapBrowserInstanceStoreError(error: unknown): BrowserConsoleErrorCode {
  if (!(error instanceof BrowserInstanceStoreError)) return "persist_failed";
  switch (error.code) {
    case "not_found":
      return "not_found";
    case "default_immutable":
      return "default_immutable";
    case "limit_reached":
      return "limit_reached";
    case "invalid_record":
      return "invalid_input";
    case "persist_failed":
      return "persist_failed";
  }
}

export interface BrowserInstanceStoreLogger {
  warn: (...args: unknown[]) => void;
}

export interface BrowserInstanceStore {
  load(): Promise<void>;
  list(): BrowserInstanceRecord[];
  get(id: string): BrowserInstanceRecord | undefined;
  create(input: BrowserInstanceCreateRequest): Promise<BrowserInstanceRecord>;
  update(input: BrowserInstanceUpdateRequest): Promise<BrowserInstanceRecord>;
  remove(id: string): Promise<void>;
}

export interface BrowserInstanceStoreOptions {
  filePath: string;
  logger?: BrowserInstanceStoreLogger;
  now?: () => number;
  idFactory?: () => string;
  maxInstances?: number;
}

export function createDefaultBrowserInstanceRecord(now: number): BrowserInstanceRecord {
  return {
    id: DEFAULT_BROWSER_INSTANCE_ID,
    name: "Default",
    partition: DEFAULT_BROWSER_INSTANCE_PARTITION,
    // v1 明确固定默认实例跟随全局代理，避免改默认实例连带影响侧边栏浏览器。
    proxy: { mode: "inherit" },
    createdAt: 0,
    updatedAt: now,
  };
}

export function createBrowserInstanceStore(
  options: BrowserInstanceStoreOptions,
): BrowserInstanceStore {
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? randomUUID;
  const maxInstances = options.maxInstances ?? MAX_BROWSER_INSTANCES;
  let instances: BrowserInstanceRecord[] = [];
  let loaded = false;
  let mutationChain: Promise<unknown> = Promise.resolve();

  const clone = (record: BrowserInstanceRecord): BrowserInstanceRecord => structuredClone(record);

  const runMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationChain.then(operation, operation);
    mutationChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const ensureLoaded = (): void => {
    if (!loaded) throw new BrowserInstanceStoreError("invalid_record", "store not loaded");
  };

  const persist = async (): Promise<void> => {
    const payload = `${JSON.stringify(
      { version: STORE_VERSION, instances } satisfies z.infer<typeof storeFileSchema>,
      null,
      2,
    )}\n`;
    const tempPath = `${options.filePath}.${process.pid}.${now()}.tmp`;
    try {
      await mkdir(dirname(options.filePath), { recursive: true });
      await writeFile(tempPath, payload, "utf8");
      await rename(tempPath, options.filePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  const normalizeRecords = (raw: readonly BrowserInstanceRecord[]): BrowserInstanceRecord[] => {
    const rest: BrowserInstanceRecord[] = [];
    const seenIds = new Set<string>();
    const seenPartitions = new Set<string>();
    let defaultRecord: BrowserInstanceRecord | undefined;
    for (const record of raw) {
      if (seenIds.has(record.id) || seenPartitions.has(record.partition)) continue;
      if (record.id === DEFAULT_BROWSER_INSTANCE_ID) {
        if (record.partition !== DEFAULT_BROWSER_INSTANCE_PARTITION) continue;
        // 默认实例必须排首位：后面的 slice 截断不能把它淘汰掉。
        defaultRecord = { ...record, proxy: { mode: "inherit" } };
      } else {
        // 非默认实例必须使用由自身 id 派生的 partition；否则会把两个实例的 Cookie 混在
        // 同一份持久存储里，代理隔离也随之失效。
        if (record.partition !== browserInstancePartitionForId(record.id)) continue;
        rest.push(record);
      }
      seenIds.add(record.id);
      seenPartitions.add(record.partition);
    }
    return [defaultRecord ?? createDefaultBrowserInstanceRecord(now()), ...rest].slice(
      0,
      maxInstances,
    );
  };

  const load = async (): Promise<void> => {
    instances = [createDefaultBrowserInstanceRecord(now())];
    try {
      const raw = await readFile(options.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const result = storeFileSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error("browser instance store schema mismatch");
      }
      instances = normalizeRecords(result.data.instances);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        options.logger?.warn("[browser-console] instance store load failed; using default", error);
        // 保留损坏文件供诊断，但不要让它阻塞启动。原子写只会在后续变更时覆盖新文件。
        await rename(options.filePath, `${options.filePath}.corrupt-${now()}`).catch(
          () => undefined,
        );
      }
    } finally {
      loaded = true;
    }
  };

  const create = async (input: BrowserInstanceCreateRequest): Promise<BrowserInstanceRecord> => {
    return runMutation(async () => {
      ensureLoaded();
      if (instances.length >= maxInstances) {
        throw new BrowserInstanceStoreError("limit_reached");
      }
      let id = idFactory();
      for (
        let attempt = 0;
        attempt < 5 && instances.some((record) => record.id === id);
        attempt += 1
      ) {
        id = idFactory();
      }
      if (instances.some((record) => record.id === id)) {
        throw new BrowserInstanceStoreError("invalid_record", "duplicate instance id");
      }
      const timestamp = now();
      const record: BrowserInstanceRecord = {
        id,
        name: input.name,
        ...(input.color ? { color: input.color } : {}),
        partition: browserInstancePartitionForId(id),
        proxy: input.proxy ?? { mode: "inherit" },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const previous = instances;
      instances = [...instances, record];
      try {
        await persist();
      } catch (error) {
        instances = previous;
        options.logger?.warn("[browser-console] instance create persist failed", error);
        throw new BrowserInstanceStoreError("persist_failed");
      }
      return clone(record);
    });
  };

  const update = async (input: BrowserInstanceUpdateRequest): Promise<BrowserInstanceRecord> => {
    return runMutation(async () => {
      ensureLoaded();
      const current = instances.find((record) => record.id === input.id);
      if (!current) throw new BrowserInstanceStoreError("not_found");
      if (current.id === DEFAULT_BROWSER_INSTANCE_ID && input.proxy !== undefined) {
        throw new BrowserInstanceStoreError("default_immutable");
      }
      const next: BrowserInstanceRecord = {
        ...current,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.proxy !== undefined ? { proxy: input.proxy } : {}),
        updatedAt: now(),
      };
      const previous = instances;
      instances = instances.map((record) => (record.id === current.id ? next : record));
      try {
        await persist();
      } catch (error) {
        instances = previous;
        options.logger?.warn("[browser-console] instance update persist failed", error);
        throw new BrowserInstanceStoreError("persist_failed");
      }
      return clone(next);
    });
  };

  const remove = async (id: string): Promise<void> => {
    return runMutation(async () => {
      ensureLoaded();
      if (id === DEFAULT_BROWSER_INSTANCE_ID) {
        throw new BrowserInstanceStoreError("default_immutable");
      }
      const current = instances.find((record) => record.id === id);
      if (!current) throw new BrowserInstanceStoreError("not_found");
      const previous = instances;
      instances = instances.filter((record) => record.id !== id);
      try {
        await persist();
      } catch (error) {
        instances = previous;
        options.logger?.warn("[browser-console] instance delete persist failed", error);
        throw new BrowserInstanceStoreError("persist_failed");
      }
    });
  };

  return {
    load,
    list: () => {
      ensureLoaded();
      return instances.map(clone);
    },
    get: (id) => {
      ensureLoaded();
      const record = instances.find((candidate) => candidate.id === id);
      return record ? clone(record) : undefined;
    },
    create,
    update,
    remove,
  };
}
