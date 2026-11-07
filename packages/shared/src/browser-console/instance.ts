import { z } from "zod";

/**
 * 浏览器控制台的实例契约。
 *
 * 实例是隔离单位：一个实例对应一个 Electron 持久 partition，因而拥有独立的
 * Cookie / Storage / 代理。Electron 没有 tab 级代理，所以同一实例内的标签必须
 * 共享代理；需要不同出口 IP 时必须新建实例。
 */

/** 默认实例固定复用内置浏览器既有 partition，避免迁移既有 Cookie 与侧边栏浏览器。 */
export const DEFAULT_BROWSER_INSTANCE_ID = "default";
export const DEFAULT_BROWSER_INSTANCE_PARTITION = "persist:zcode-embedded-browser";

/** 新建实例的 partition 前缀；main 的 webview attach 白名单据此识别控制台实例。 */
export const BROWSER_INSTANCE_PARTITION_PREFIX = "persist:zcode-browser-inst-";

/** 产品上限；超限显式失败，不静默淘汰用户实例。 */
export const MAX_BROWSER_INSTANCES = 8;
export const MAX_BROWSER_INSTANCE_NAME_LENGTH = 64;

export const browserInstanceColorSchema = z.enum([
  "blue",
  "green",
  "orange",
  "purple",
  "pink",
  "gray",
]);
export type BrowserInstanceColor = z.infer<typeof browserInstanceColorSchema>;

const browserProxyBypassRuleSchema = z.string().trim().min(1).max(255);

/**
 * 实例代理配置。`inherit` 跟随设置页的全局代理（默认实例在 v1 固定用它）；
 * `fixed` 只保存非敏感端点信息，凭据在后续阶段单独接入，不与端点混存。
 */
export const browserProxyConfigSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("inherit") }).strict(),
  z.object({ mode: z.literal("direct") }).strict(),
  z.object({ mode: z.literal("system") }).strict(),
  z
    .object({
      mode: z.literal("fixed"),
      protocol: z.enum(["http", "https", "socks5"]),
      host: z.string().trim().min(1).max(255),
      port: z.number().int().min(1).max(65535),
      bypassRules: z.array(browserProxyBypassRuleSchema).max(50).optional(),
    })
    .strict(),
]);
export type BrowserProxyConfig = z.infer<typeof browserProxyConfigSchema>;

export const browserInstanceRecordSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(MAX_BROWSER_INSTANCE_NAME_LENGTH),
    color: browserInstanceColorSchema.optional(),
    /** 必须与 id 对应：默认实例用默认 partition，其余用实例前缀。 */
    partition: z.string().trim().min(1).max(160),
    proxy: browserProxyConfigSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserInstanceRecord = z.infer<typeof browserInstanceRecordSchema>;

export const browserInstanceCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_BROWSER_INSTANCE_NAME_LENGTH),
    color: browserInstanceColorSchema.optional(),
    proxy: browserProxyConfigSchema.optional(),
  })
  .strict();
export type BrowserInstanceCreateRequest = z.infer<typeof browserInstanceCreateRequestSchema>;

export const browserInstanceUpdateRequestSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(MAX_BROWSER_INSTANCE_NAME_LENGTH).optional(),
    color: browserInstanceColorSchema.optional(),
    proxy: browserProxyConfigSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.color !== undefined || value.proxy !== undefined,
    { message: "at least one field must be updated" },
  );
export type BrowserInstanceUpdateRequest = z.infer<typeof browserInstanceUpdateRequestSchema>;

export const browserInstanceIdRequestSchema = z
  .object({ id: z.string().trim().min(1).max(64) })
  .strict();
export type BrowserInstanceIdRequest = z.infer<typeof browserInstanceIdRequestSchema>;

export const browserConsolePrepareGuestAttachRequestSchema = z
  .object({
    tabId: z.string().trim().min(1),
    instanceId: z.string().trim().min(1).max(64),
  })
  .strict();
export type BrowserConsolePrepareGuestAttachRequest = z.infer<
  typeof browserConsolePrepareGuestAttachRequestSchema
>;

export const browserConsoleClearInstanceDataRequestSchema = z
  .object({
    instanceId: z.string().trim().min(1).max(64),
    mode: z.enum(["cache", "all"]),
  })
  .strict();
export type BrowserConsoleClearInstanceDataRequest = z.infer<
  typeof browserConsoleClearInstanceDataRequestSchema
>;

/**
 * 控制台 IPC 的结构化错误码。与 browser-use 的 `BrowserErrorCode` 分开：
 * 这里描述的是实例管理失败，不是页面命令失败。
 */
export const browserConsoleErrorCodeSchema = z.enum([
  "invalid_input",
  "not_found",
  "default_immutable",
  "limit_reached",
  "persist_failed",
  "session_unavailable",
  "clear_failed",
  /** 同一 tabId 已登记到另一个实例/窗口，拒绝复用。 */
  "tab_conflict",
]);
export type BrowserConsoleErrorCode = z.infer<typeof browserConsoleErrorCodeSchema>;

export interface BrowserConsoleInstanceMutationResult {
  ok: boolean;
  error?: BrowserConsoleErrorCode;
  instance?: BrowserInstanceRecord;
}

export interface BrowserConsoleDeleteResult {
  ok: boolean;
  error?: BrowserConsoleErrorCode;
}

export interface BrowserConsolePrepareGuestAttachResult {
  ok: boolean;
  error?: BrowserConsoleErrorCode;
}

/** 默认实例只允许默认 partition；其余实例只允许带实例前缀的 partition。 */
export function isBrowserConsolePartition(partition: string | undefined): partition is string {
  return typeof partition === "string" && partition.startsWith(BROWSER_INSTANCE_PARTITION_PREFIX);
}

export function browserInstancePartitionForId(id: string): string {
  return `${BROWSER_INSTANCE_PARTITION_PREFIX}${id}`;
}
