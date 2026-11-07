import type { IPlatformService } from "@zcode/shared";

type DesktopBrowserConsolePlatformBridge = Pick<
  IPlatformService,
  | "browserConsoleListInstances"
  | "browserConsoleCreateInstance"
  | "browserConsoleUpdateInstance"
  | "browserConsoleDeleteInstance"
  | "browserConsolePrepareGuestAttach"
  | "browserConsoleClearInstanceData"
  | "browserConsoleRegisterTab"
  | "browserConsoleUnregisterTab"
  | "browserConsoleNetworkSubscribe"
  | "browserConsoleNetworkSnapshot"
  | "browserConsoleNetworkClear"
  | "browserConsoleNetworkExportHar"
  | "browserConsoleAcquireDeepCapture"
  | "browserConsoleReleaseDeepCapture"
  | "browserConsoleGetResponseBody"
  | "browserConsoleSetAgentBinding"
  | "browserConsoleGetAgentBinding"
  | "onBrowserConsoleNetworkBatch"
  | "onBrowserConsoleAgentBindingChanged"
  | "onBrowserConsoleOpenTab"
>;

/**
 * 浏览器控制台的 renderer 平台桥。
 *
 * `IPlatformService` 上这些方法是可选的，UI 用「方法是否存在」做能力探测（Web 壳层没有这条链路）。
 * 无条件转发会让桌面端被判成"有能力"，而旧 preload（HMR、升级后未重启的窗口）真正调用时抛
 * `window.zcode.xxx is not a function` —— 因此与 `desktopBrowserPlatformBridge` 同一判据：
 * 缺失的调用方法如实反映成 `undefined`，事件订阅退化成 no-op disposer。
 *
 * 与那个常量桥的差别：这里在每次 `createDesktopPlatform()` 时求值，不在模块加载期捕获 window。
 * 少这一步的话，「preload 缺方法」和「preload 有方法」两种形态无法在同一个进程里先后验证。
 */
export function createDesktopBrowserConsolePlatformBridge(): DesktopBrowserConsolePlatformBridge {
  const bridge = window.zcode;
  return {
    browserConsoleListInstances: bridge.browserConsoleListInstances
      ? () => bridge.browserConsoleListInstances!()
      : undefined,
    browserConsoleCreateInstance: bridge.browserConsoleCreateInstance
      ? (input) => bridge.browserConsoleCreateInstance!(input)
      : undefined,
    browserConsoleUpdateInstance: bridge.browserConsoleUpdateInstance
      ? (input) => bridge.browserConsoleUpdateInstance!(input)
      : undefined,
    browserConsoleDeleteInstance: bridge.browserConsoleDeleteInstance
      ? (input) => bridge.browserConsoleDeleteInstance!(input)
      : undefined,
    browserConsolePrepareGuestAttach: bridge.browserConsolePrepareGuestAttach
      ? (input) => bridge.browserConsolePrepareGuestAttach!(input)
      : undefined,
    browserConsoleClearInstanceData: bridge.browserConsoleClearInstanceData
      ? (input) => bridge.browserConsoleClearInstanceData!(input)
      : undefined,
    browserConsoleRegisterTab: bridge.browserConsoleRegisterTab
      ? (input) => bridge.browserConsoleRegisterTab!(input)
      : undefined,
    browserConsoleUnregisterTab: bridge.browserConsoleUnregisterTab
      ? (input) => bridge.browserConsoleUnregisterTab!(input)
      : undefined,
    browserConsoleNetworkSubscribe: bridge.browserConsoleNetworkSubscribe
      ? (input) => bridge.browserConsoleNetworkSubscribe!(input)
      : undefined,
    browserConsoleNetworkSnapshot: bridge.browserConsoleNetworkSnapshot
      ? (input) => bridge.browserConsoleNetworkSnapshot!(input)
      : undefined,
    browserConsoleNetworkClear: bridge.browserConsoleNetworkClear
      ? (input) => bridge.browserConsoleNetworkClear!(input)
      : undefined,
    browserConsoleNetworkExportHar: bridge.browserConsoleNetworkExportHar
      ? (input) => bridge.browserConsoleNetworkExportHar!(input)
      : undefined,
    browserConsoleAcquireDeepCapture: bridge.browserConsoleAcquireDeepCapture
      ? (input) => bridge.browserConsoleAcquireDeepCapture!(input)
      : undefined,
    browserConsoleReleaseDeepCapture: bridge.browserConsoleReleaseDeepCapture
      ? (input) => bridge.browserConsoleReleaseDeepCapture!(input)
      : undefined,
    browserConsoleGetResponseBody: bridge.browserConsoleGetResponseBody
      ? (input) => bridge.browserConsoleGetResponseBody!(input)
      : undefined,
    browserConsoleSetAgentBinding: bridge.browserConsoleSetAgentBinding
      ? (input) => bridge.browserConsoleSetAgentBinding!(input)
      : undefined,
    browserConsoleGetAgentBinding: bridge.browserConsoleGetAgentBinding
      ? (input) => bridge.browserConsoleGetAgentBinding!(input)
      : undefined,
    onBrowserConsoleNetworkBatch: (handler) =>
      bridge.onBrowserConsoleNetworkBatch?.(handler) ?? (() => {}),
    onBrowserConsoleAgentBindingChanged: (handler) =>
      bridge.onBrowserConsoleAgentBindingChanged?.(handler) ?? (() => {}),
    onBrowserConsoleOpenTab: (handler) => bridge.onBrowserConsoleOpenTab?.(handler) ?? (() => {}),
  };
}
