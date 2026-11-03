import type { Session } from "electron";
import type {
  BrowserConsoleClearInstanceDataRequest,
  BrowserConsoleDeleteResult,
  BrowserConsoleInstanceMutationResult,
  BrowserConsolePrepareGuestAttachResult,
  BrowserInstanceCreateRequest,
  BrowserInstanceRecord,
  BrowserInstanceUpdateRequest,
  EmbeddedBrowserDataClearResult,
} from "@zcode/shared";
import type { installBrowserRestoreBootstrapProtocol } from "../browserView/browserRestoreBootstrapProtocol.js";
import type { DesktopNetworkPolicySettings } from "../desktopNetworkPolicy.js";
import type { applyEmbeddedBrowserPermissionPolicy } from "../embeddedBrowserPermissionPolicy.js";
import type { BrowserConsolePermissionDeps } from "./browserInstanceSession.js";

export interface BrowserConsoleRuntimeLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface BrowserConsoleRuntimeInternals {
  /** Session 工厂；由 index.ts 注入 electron session.fromPartition。 */
  fromPartition(partition: string): Session;
  /** 清理实例数据；由 index.ts 注入 browserDataManager 的 clearEmbeddedBrowserData。 */
  clearData(input: {
    logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
    mode: "cache" | "all";
    targetSession: Session;
  }): Promise<EmbeddedBrowserDataClearResult>;
  applyPermissionPolicy?: typeof applyEmbeddedBrowserPermissionPolicy;
  installRestoreProtocol?: typeof installBrowserRestoreBootstrapProtocol;
}

export interface InitializeBrowserConsoleRuntimeInput {
  userDataPath: string;
  logger: BrowserConsoleRuntimeLogger;
  settings: DesktopNetworkPolicySettings;
  permission: BrowserConsolePermissionDeps;
  /** 默认实例的权限/网络策略是否已由 index.ts 装配成功。 */
  defaultInstanceReady?: boolean;
  now?: () => number;
  idFactory?: () => string;
  maxInstances?: number;
  internal: BrowserConsoleRuntimeInternals;
}

export interface BrowserConsoleRuntime {
  list(): BrowserInstanceRecord[];
  get(id: string): BrowserInstanceRecord | undefined;
  partitionOf(id: string): string | undefined;
  /** 仅供 main 内部的网络采集等模块取得已装配的 Session；不暴露给 renderer。 */
  partitionSession(partition: string): Session;
  create(input: BrowserInstanceCreateRequest): Promise<BrowserConsoleInstanceMutationResult>;
  update(input: BrowserInstanceUpdateRequest): Promise<BrowserConsoleInstanceMutationResult>;
  remove(id: string): Promise<BrowserConsoleDeleteResult>;
  prepareGuestAttach(input: {
    tabId: string;
    instanceId: string;
    windowId: number;
  }): Promise<BrowserConsolePrepareGuestAttachResult>;
  clearInstanceData(
    input: BrowserConsoleClearInstanceDataRequest,
  ): Promise<EmbeddedBrowserDataClearResult>;
}
