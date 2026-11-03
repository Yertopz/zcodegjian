import { z } from "zod";

/**
 * 浏览器控制台网络面板契约。
 *
 * 两层采集：
 * - 浅采集（`webRequest`，常开）：URL / 方法 / 状态 / 头 / 近似时间，无响应体。
 * - 深采集（CDP `Network` 域，按需租约）：精确 timing、远程 IP、响应体、WS 帧。
 *
 * v1 这些数据只给人类 UI：不向 Agent 暴露请求列表、头或响应体，也不新增网络工具。
 */

export const BROWSER_NETWORK_MAX_ENTRIES = 2000;
export const BROWSER_NETWORK_MAX_BODY_BYTES = 1024 * 1024;
export const BROWSER_NETWORK_BATCH_INTERVAL_MS = 100;
export const BROWSER_NETWORK_BATCH_MAX_ENTRIES = 200;

/** 默认脱敏的请求/响应头（小写比较）。 */
export const BROWSER_NETWORK_SENSITIVE_HEADERS = [
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
] as const;

export const BROWSER_NETWORK_REDACTED_VALUE = "••••••";

export const browserNetworkEntrySchema = z
  .object({
    id: z.string().min(1),
    instanceId: z.string().min(1),
    /** service worker / 早于 tab 登记的请求为 null。 */
    tabId: z.string().nullable(),
    frameUrl: z.string().optional(),
    source: z.enum(["webRequest", "cdp"]),
    method: z.string(),
    url: z.string(),
    resourceType: z.string(),
    statusCode: z.number().int().optional(),
    statusLine: z.string().optional(),
    requestHeaders: z.record(z.string(), z.string()).optional(),
    responseHeaders: z.record(z.string(), z.array(z.string())).optional(),
    fromCache: z.boolean().optional(),
    error: z.string().optional(),
    startedAt: z.number(),
    responseStartedAt: z.number().optional(),
    completedAt: z.number().optional(),
    /** 近似响应大小（字节）；浅采集拿不到时缺省。 */
    size: z.number().optional(),
    /** 重定向目标（`onBeforeRedirect`）。 */
    redirectUrl: z.string().optional(),
    /** 深采集独有：远程 IP 与协议。 */
    remoteAddress: z.string().optional(),
    protocol: z.string().optional(),
    /** 深采集独有：该条响应体是否已可读取。 */
    bodyAvailable: z.boolean().optional(),
    /** 深采集独有：不可读取时的人类可读原因。 */
    bodyUnavailableReason: z.string().optional(),
    /** 深采集独有：WebSocket 帧（仅保留最近少量，payload 已截断）。 */
    webSocketFrames: z
      .array(
        z
          .object({
            direction: z.enum(["sent", "received"]),
            opcode: z.number().int().optional(),
            payload: z.string(),
            at: z.number(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type BrowserNetworkEntry = z.infer<typeof browserNetworkEntrySchema>;

export const browserNetworkSubscribeRequestSchema = z
  .object({
    instanceId: z.string().trim().min(1).max(64),
    enabled: z.boolean(),
  })
  .strict();
export type BrowserNetworkSubscribeRequest = z.infer<typeof browserNetworkSubscribeRequestSchema>;

export const browserNetworkSnapshotRequestSchema = z
  .object({
    instanceId: z.string().trim().min(1).max(64),
    tabId: z.string().trim().min(1).max(128).nullable().optional(),
    /** 用户显式「显示敏感头」时返回原文；缺省脱敏。状态只在当前面板会话内有效。 */
    showSensitiveHeaders: z.boolean().optional(),
  })
  .strict();
export type BrowserNetworkSnapshotRequest = z.infer<typeof browserNetworkSnapshotRequestSchema>;

export const browserNetworkClearRequestSchema = z
  .object({ instanceId: z.string().trim().min(1).max(64) })
  .strict();
export type BrowserNetworkClearRequest = z.infer<typeof browserNetworkClearRequestSchema>;

export const browserNetworkExportHarRequestSchema = z
  .object({
    instanceId: z.string().trim().min(1).max(64),
    tabId: z.string().trim().min(1).max(128).nullable().optional(),
    showSensitiveHeaders: z.boolean().optional(),
  })
  .strict();
export type BrowserNetworkExportHarRequest = z.infer<typeof browserNetworkExportHarRequestSchema>;

export const browserNetworkDeepCaptureRequestSchema = z
  .object({
    instanceId: z.string().trim().min(1).max(64),
    tabId: z.string().trim().min(1).max(128),
  })
  .strict();
export type BrowserNetworkDeepCaptureRequest = z.infer<
  typeof browserNetworkDeepCaptureRequestSchema
>;

export const browserNetworkResponseBodyRequestSchema = z
  .object({
    instanceId: z.string().trim().min(1).max(64),
    tabId: z.string().trim().min(1).max(128),
    requestId: z.string().trim().min(1).max(256),
  })
  .strict();
export type BrowserNetworkResponseBodyRequest = z.infer<
  typeof browserNetworkResponseBodyRequestSchema
>;

export type BrowserNetworkResponseBodyResult =
  | { ok: true; body: string; base64Encoded: boolean; truncated: boolean }
  | { ok: false; reason: string };

export interface BrowserNetworkBatchPayload {
  instanceId: string;
  entries: BrowserNetworkEntry[];
  /** 因环形缓冲淘汰而未进入本批次的条数（UI 显示丢弃计数）。 */
  dropped: number;
}

export interface BrowserNetworkHarExportResult {
  ok: boolean;
  /** HAR 1.2 JSON 字符串；由 renderer 触发下载，不写盘。 */
  har?: string;
  error?: string;
}

/** 深采集租约的申请结果；失败原因用于 UI 显式提示，不静默降级。 */
export interface BrowserConsoleDeepCaptureResult {
  ok: boolean;
  error?: "not_found" | "tab_not_attached" | "debugger_unavailable" | "session_unavailable";
}

export interface BrowserConsoleNetworkSnapshotResult {
  entries: BrowserNetworkEntry[];
  /** 环形缓冲已淘汰的条数；UI 显示丢弃计数。 */
  dropped: number;
}

/** 深采集开启/关闭时插入列表的分隔标记，避免浅/深数据被误认为连续。 */
export const BROWSER_NETWORK_DEEP_MODE_SEPARATOR_ID = "__console_deep_mode_separator__";
