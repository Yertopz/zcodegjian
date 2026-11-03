import { join } from "node:path";
import type { Session } from "electron";
import {
  DEFAULT_BROWSER_INSTANCE_ID,
  MAX_BROWSER_INSTANCES,
  type BrowserInstanceRecord,
} from "@zcode/shared";
import { installBrowserRestoreBootstrapProtocol } from "../browserView/browserRestoreBootstrapProtocol.js";
import type { DesktopNetworkPolicySettings } from "../desktopNetworkPolicy.js";
import { applyEmbeddedBrowserPermissionPolicy } from "../embeddedBrowserPermissionPolicy.js";
import { removeEmbeddedBrowserSitePermissionsForPartition } from "../embeddedBrowserSitePermissions.js";
import { BrowserProxyConfigError, buildBrowserInstanceProxyConfig } from "./browserProxyConfig.js";
import { applyBrowserConsoleNetworkPolicy } from "./browserConsoleNetworkPolicy.js";
import {
  createBrowserInstanceStore,
  mapBrowserInstanceStoreError,
} from "./browserInstanceStore.js";
import {
  clearBrowserConsoleTabsForInstance,
  getBrowserConsoleTab,
} from "./browserConsoleTabRegistry.js";
import { clearBrowserConsoleAgentBindingsForInstance } from "./browserConsoleAgentBinding.js";
import {
  disposeBrowserConsoleNetwork,
  ensureBrowserConsoleNetworkCapture,
} from "./browserConsoleNetworkCapture.js";
import { cleanupBrowserConsoleOrphanPartitions } from "./browserConsoleOrphanCleanup.js";
import { prepareBrowserInstanceSession } from "./browserInstanceSession.js";
import {
  prepareBrowserConsoleGuestAttach,
  registerBrowserConsolePartition,
  unregisterBrowserConsolePartition,
} from "./browserConsolePartitionGuard.js";
import type {
  BrowserConsoleRuntime,
  InitializeBrowserConsoleRuntimeInput,
} from "./browserConsoleRuntimeTypes.js";

/**
 * 浏览器控制台运行时：实例注册表 + 每实例 Session 装配的唯一所有者。
 *
 * 这是 main 进程单例（与 embeddedBrowserSitePermissions 同款模式）。renderer 只通过
 * IPC 发命令，不持有实例事实；Session 代理/权限是注册表记录的派生投影。
 */

const STORE_FILE_NAME = "browser-instances.json";

let runtime: BrowserConsoleRuntime | null = null;

export async function initializeBrowserConsoleRuntime(
  input: InitializeBrowserConsoleRuntimeInput,
): Promise<void> {
  if (runtime) return;

  const store = createBrowserInstanceStore({
    filePath: join(input.userDataPath, STORE_FILE_NAME),
    logger: input.logger,
    ...(input.now ? { now: input.now } : {}),
    ...(input.idFactory ? { idFactory: input.idFactory } : {}),
    maxInstances: input.maxInstances ?? MAX_BROWSER_INSTANCES,
  });
  await store.load();

  // 注册表已无记录的实例分区在启动时清理；不阻塞实例装配。
  const activePartitions = new Set(store.list().map((instance) => instance.partition));
  void cleanupBrowserConsoleOrphanPartitions({
    userDataPath: input.userDataPath,
    activePartitions,
    logger: input.logger,
  }).catch((error: unknown) => {
    input.logger.warn("[browser-console] orphan partition scan failed", error);
  });

  const preparedPartitions = new Set<string>();
  const defaultInstanceReady = input.defaultInstanceReady !== false;
  const fromPartition = input.internal.fromPartition;

  /**
   * 只重装代理/证书。已装配过权限的实例在改代理时走这条路径：
   * 重复调用 applyEmbeddedBrowserPermissionPolicy 会叠加 select-* 监听，
   * 也会清空 session-only 授权，因此不能把整条装配链重跑一遍。
   */
  const applyNetworkPolicyToSession = async (
    session: Session,
    instance: BrowserInstanceRecord,
    settings: DesktopNetworkPolicySettings,
  ): Promise<void> => {
    await applyBrowserConsoleNetworkPolicy({ session, instance, settings, logger: input.logger });
  };
  const applyPermissionPolicy =
    input.internal.applyPermissionPolicy ?? applyEmbeddedBrowserPermissionPolicy;
  const installRestoreProtocol =
    input.internal.installRestoreProtocol ?? installBrowserRestoreBootstrapProtocol;
  const clearData = input.internal.clearData;

  const prepareSession = async (instance: BrowserInstanceRecord): Promise<void> => {
    await prepareBrowserInstanceSession({
      instance,
      settings: input.settings,
      permission: input.permission,
      deps: {
        getSession: (partition) => fromPartition(partition),
        applyNetworkPolicy: async ({ session, instance: target, settings }) => {
          await applyNetworkPolicyToSession(session, target, settings);
        },
        applyPermissionPolicy: async ({ session, permission }) => {
          await applyPermissionPolicy(session, {
            logger: input.logger,
            // 站点同意记录按 partition 隔离。默认实例已经在 index.ts 初始化过 store；
            // 其他实例只读取同一份已加载记录，不重复 load，避免把刚写入的决定覆盖。
            initializeStore: false,
            partition: instance.partition,
            ...(permission.prompt ? { prompt: permission.prompt } : {}),
            ...(permission.devicePicker ? { devicePicker: permission.devicePicker } : {}),
            ...(permission.onDisplayMediaRequest
              ? { onDisplayMediaRequest: permission.onDisplayMediaRequest }
              : {}),
          });
        },
        installRestoreProtocol: (protocol) => {
          installRestoreProtocol(protocol);
        },
        registerPartition: (partition) => {
          registerBrowserConsolePartition(partition);
          preparedPartitions.add(partition);
          // 浅采集随实例 Session 一起就绪，失败不影响实例可用性（面板会显示空列表）。
          try {
            ensureBrowserConsoleNetworkCapture(instance.id, partition, fromPartition);
          } catch (error) {
            input.logger.warn(
              `[browser-console] network capture unavailable id=${instance.id}`,
              error,
            );
          }
        },
      },
    });
  };

  const markUnavailable = (id: string, error: unknown): void => {
    input.logger.warn(`[browser-console] instance session unavailable id=${id}`, error);
  };

  const ensurePrepared = async (
    instance: BrowserInstanceRecord,
    force = false,
  ): Promise<boolean> => {
    if (instance.id === DEFAULT_BROWSER_INSTANCE_ID) {
      if (!defaultInstanceReady) {
        markUnavailable(instance.id, new Error("default instance policy bootstrap failed"));
        return false;
      }
      // 默认实例的 partition 由 index.ts 装配；它不是控制台前缀，guard 不参与白名单。
      return true;
    }
    if (!force && preparedPartitions.has(instance.partition)) return true;
    try {
      await prepareSession(instance);
      return true;
    } catch (error) {
      unregisterBrowserConsolePartition(instance.partition);
      preparedPartitions.delete(instance.partition);
      markUnavailable(instance.id, error);
      return false;
    }
  };

  for (const instance of store.list()) {
    if (instance.id === DEFAULT_BROWSER_INSTANCE_ID) continue;
    await ensurePrepared(instance);
  }
  if (defaultInstanceReady) {
    const defaultInstance = store.get(DEFAULT_BROWSER_INSTANCE_ID);
    if (defaultInstance) {
      try {
        ensureBrowserConsoleNetworkCapture(
          defaultInstance.id,
          defaultInstance.partition,
          fromPartition,
        );
      } catch (error) {
        input.logger.warn("[browser-console] default network capture unavailable", error);
      }
    }
  }

  runtime = {
    list: () => store.list(),
    get: (id) => store.get(id),
    partitionOf: (id) => store.get(id)?.partition,
    partitionSession: (partition) => fromPartition(partition),

    create: async (request) => {
      try {
        // 先纯校验代理端点，避免把非法配置落盘后再回滚。
        if (request.proxy) {
          buildBrowserInstanceProxyConfig(request.proxy, {
            httpProxy: input.settings.httpProxy,
            httpProxyNoProxy: input.settings.httpProxyNoProxy,
          });
        }
      } catch (error) {
        if (error instanceof BrowserProxyConfigError) {
          return { ok: false, error: "invalid_input" };
        }
        throw error;
      }

      let instance: BrowserInstanceRecord;
      try {
        instance = await store.create(request);
      } catch (error) {
        return { ok: false, error: mapBrowserInstanceStoreError(error) };
      }

      if (!(await ensurePrepared(instance))) {
        // 创建失败必须回滚注册表，不留下半初始化实例。
        await store.remove(instance.id).catch((error: unknown) => {
          input.logger.warn(`[browser-console] rollback failed id=${instance.id}`, error);
        });
        unregisterBrowserConsolePartition(instance.partition);
        preparedPartitions.delete(instance.partition);
        return { ok: false, error: "session_unavailable" };
      }
      return { ok: true, instance };
    },

    update: async (request) => {
      const current = store.get(request.id);
      if (!current) return { ok: false, error: "not_found" };
      try {
        if (request.proxy) {
          buildBrowserInstanceProxyConfig(request.proxy, {
            httpProxy: input.settings.httpProxy,
            httpProxyNoProxy: input.settings.httpProxyNoProxy,
          });
        }
      } catch (error) {
        if (error instanceof BrowserProxyConfigError) {
          return { ok: false, error: "invalid_input" };
        }
        throw error;
      }

      let next: BrowserInstanceRecord;
      try {
        next = await store.update(request);
      } catch (error) {
        return { ok: false, error: mapBrowserInstanceStoreError(error) };
      }

      const proxyChanged = request.proxy !== undefined;
      const alreadyPrepared = preparedPartitions.has(next.partition);
      if (proxyChanged && alreadyPrepared) {
        // 已装配过权限的实例只重装代理/证书；重复跑权限装配会叠加 select-* 监听，
        // 也会清空 session-only 授权。
        try {
          await applyNetworkPolicyToSession(fromPartition(next.partition), next, input.settings);
        } catch (error) {
          markUnavailable(next.id, error);
          return { ok: false, error: "session_unavailable", instance: next };
        }
      } else if (!alreadyPrepared) {
        // 未装配过的实例（如启动失败后重试）走完整装配链。
        const ready = await ensurePrepared(next, proxyChanged);
        if (!ready) return { ok: false, error: "session_unavailable", instance: next };
      }
      return { ok: true, instance: next };
    },

    remove: async (id) => {
      if (id === DEFAULT_BROWSER_INSTANCE_ID) {
        return { ok: false, error: "default_immutable" };
      }
      const instance = store.get(id);
      if (!instance) return { ok: false, error: "not_found" };

      // 先清数据再删记录：清理失败时保留记录，用户可重试。代价是清除成功后若注册表
      // 落盘失败会留下一个空实例；这比留下包含登录态的孤儿 partition 更可控。
      const cleared = await clearData({
        logger: input.logger,
        mode: "all",
        targetSession: fromPartition(instance.partition),
      });
      if (!cleared.success) {
        return { ok: false, error: "clear_failed" };
      }

      try {
        await store.remove(id);
      } catch (error) {
        return { ok: false, error: mapBrowserInstanceStoreError(error) };
      }
      unregisterBrowserConsolePartition(instance.partition);
      preparedPartitions.delete(instance.partition);
      clearBrowserConsoleTabsForInstance(id);
      clearBrowserConsoleAgentBindingsForInstance(id);
      disposeBrowserConsoleNetwork(id);
      // 实例删除联动清理其站点同意记录，避免下次用同一 id 新建时继承旧授权。
      void removeEmbeddedBrowserSitePermissionsForPartition(instance.partition).catch(
        (error: unknown) => {
          input.logger.warn(`[browser-console] site permission cleanup failed id=${id}`, error);
        },
      );
      input.logger.info(`[browser-console] instance deleted id=${id}`);
      return { ok: true };
    },

    prepareGuestAttach: async ({ tabId, instanceId, windowId }) => {
      const instance = store.get(instanceId);
      if (!instance) return { ok: false, error: "not_found" };
      // tab 归属必须先登记：renderer 不能用别的实例/窗口的 tabId 借道。
      const tab = getBrowserConsoleTab(tabId);
      if (!tab || tab.instanceId !== instanceId) return { ok: false, error: "tab_conflict" };
      if (tab.windowId !== windowId) return { ok: false, error: "tab_conflict" };
      if (!(await ensurePrepared(instance))) {
        return { ok: false, error: "session_unavailable" };
      }
      // 默认 partition 也是侧边栏既有浏览器的 partition，`will-attach-webview` 已无条件
      // 允许；这里不再要求 pending 许可。阶段 2 接入 tab 归属校验后再决定是否收紧。
      if (instance.id !== DEFAULT_BROWSER_INSTANCE_ID) {
        if (
          !prepareBrowserConsoleGuestAttach({
            windowId,
            partition: instance.partition,
          })
        ) {
          return { ok: false, error: "session_unavailable" };
        }
      }
      // 阶段 2 会在这里接入 BrowserGuestManager 的 tab 归属校验；当前只有实例级校验。
      input.logger.info(
        `[browser-console] prepared guest attach instance=${instanceId} tab=${tabId}`,
      );
      return { ok: true };
    },

    clearInstanceData: async ({ instanceId, mode }) => {
      const instance = store.get(instanceId);
      if (!instance) return { success: false, error: "browser_instance_not_found" };
      return clearData({
        logger: input.logger,
        mode,
        targetSession: fromPartition(instance.partition),
      });
    },
  };
}

export function getBrowserConsoleRuntime(): BrowserConsoleRuntime {
  if (!runtime) {
    throw new Error("browser console runtime is not initialized");
  }
  return runtime;
}

/** 仅测试用：隔离 module 单例。 */
export function resetBrowserConsoleRuntimeForTest(): void {
  runtime = null;
}
