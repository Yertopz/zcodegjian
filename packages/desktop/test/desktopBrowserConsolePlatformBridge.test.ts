import assert from "node:assert/strict";
import test from "node:test";

/**
 * 接缝回归：浏览器控制台的 preload 方法必须映射进 `IPlatformService`。
 *
 * 实测背景：preload / shared / main 三处都接好了，唯独 `createDesktopPlatform` 没转发，
 * UI 侧 `platform.browserConsoleCreateInstance?.()` 直接拿到 undefined ⇒ 点「保存」后
 * 界面只报「创建实例失败」，主进程日志一条都没有（IPC 根本没发出）。
 * 这类形态单看任一侧都是绿的，只有把 preload 与 platform 接起来才验得到。
 *
 * 反向同样重要：`IPlatformService` 上这些方法是可选的，UI 用「是否存在」判能力。
 * 无条件转发会让旧 preload（HMR / 升级后未重启）被判成"有能力"，点下去才抛 TypeError。
 *
 * 运行：cd packages/desktop && node --import tsx --test test/desktopBrowserConsolePlatformBridge.test.ts
 */

const INVOKE_METHODS = [
  "browserConsoleListInstances",
  "browserConsoleCreateInstance",
  "browserConsoleUpdateInstance",
  "browserConsoleDeleteInstance",
  "browserConsolePrepareGuestAttach",
  "browserConsoleClearInstanceData",
  "browserConsoleRegisterTab",
  "browserConsoleUnregisterTab",
  "browserConsoleNetworkSubscribe",
  "browserConsoleNetworkSnapshot",
  "browserConsoleNetworkClear",
  "browserConsoleNetworkExportHar",
  "browserConsoleAcquireDeepCapture",
  "browserConsoleReleaseDeepCapture",
  "browserConsoleGetResponseBody",
  "browserConsoleSetAgentBinding",
  "browserConsoleGetAgentBinding",
] as const;

const EVENT_METHODS = [
  "onBrowserConsoleNetworkBatch",
  "onBrowserConsoleAgentBindingChanged",
  "onBrowserConsoleOpenTab",
] as const;

function installWindow(zcode: Record<string, unknown>): void {
  (globalThis as unknown as { window?: unknown }).window = {
    zcode,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

// desktopBrowserPlatformBridge 在模块加载期读 window.zcode，先装一个空壳避免加载期崩。
installWindow({});
const { createDesktopPlatform } = await import("../src/renderer/src/desktopPlatform.js");

test("preload 缺控制台方法 ⇒ IPlatformService 上必须缺失（UI 能力探测才判成无此能力）", () => {
  installWindow({});
  const platform = createDesktopPlatform({ isLocalDevelopmentRuntime: false }) as unknown as Record<
    string,
    unknown
  >;
  for (const name of INVOKE_METHODS) {
    assert.equal(platform[name], undefined, `${name} 缺失时必须如实反映成 undefined`);
  }
  // 事件订阅退化成 no-op disposer（与 desktopBrowserPlatformBridge 的既有写法一致）。
  for (const name of EVENT_METHODS) {
    assert.equal(typeof platform[name], "function", `${name} 缺失时仍应是可调用的 no-op`);
    assert.doesNotThrow(() => (platform[name] as (h: () => void) => unknown)(() => {}));
  }
});

test("preload 有控制台方法 ⇒ 全部转发，且请求原样穿透到 preload", async () => {
  const calls: Array<{ name: string; input: unknown }> = [];
  const zcode: Record<string, unknown> = {};
  for (const name of INVOKE_METHODS) {
    zcode[name] = async (input: unknown) => {
      calls.push({ name, input });
      return { ok: true, echo: input };
    };
  }
  installWindow(zcode);
  const platform = createDesktopPlatform({ isLocalDevelopmentRuntime: false });

  for (const name of INVOKE_METHODS) {
    assert.equal(typeof platform[name], "function", `${name} 必须被映射进 IPlatformService`);
  }

  const result = await platform.browserConsoleCreateInstance?.({ name: "冒烟实例" });
  assert.deepEqual(result, { ok: true, echo: { name: "冒烟实例" } });
  assert.deepEqual(
    calls.map((call) => call.name),
    ["browserConsoleCreateInstance"],
    "只应发出被调用的那一条",
  );
  assert.deepEqual(calls[0]?.input, { name: "冒烟实例" }, "入参必须原样穿透");
});

test("事件订阅透传到 preload，并返回其 disposer", () => {
  let disposed = 0;
  const zcode: Record<string, unknown> = {
    onBrowserConsoleNetworkBatch: () => () => {
      disposed += 1;
    },
  };
  installWindow(zcode);
  const platform = createDesktopPlatform({ isLocalDevelopmentRuntime: false });
  const dispose = platform.onBrowserConsoleNetworkBatch?.(() => {});
  assert.equal(typeof dispose, "function");
  dispose?.();
  assert.equal(disposed, 1, "返回的必须是 preload 的 disposer，而不是吞掉的 no-op");
});
