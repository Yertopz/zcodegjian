/**
 * Windows deep-link 协议注册的启动参数注入加固(X11,移植上游 v3.15.1)。
 *
 * 钉住的契约:Windows 上经 setAsDefaultProtocolClient 注册的命令行必须让 zcode:// URL
 * 位于 -- 之后。Windows 引号拆分会把 URL 内容拆成多个 argv 片段,其中 -- 开头的片段
 * 会被 Electron 当作启动开关(inspector / gpu / js-flags),而开关解析早于应用 JS 与
 * 单实例锁,handleDeepLink 的后续校验无法拦截。插入 -- 终止符后,URL 整体成为普通
 * argv 项,只能走 deep-link 既有白名单提取。
 *
 * 为什么用桩:node:test 里无法 require 真实 electron(见 electronStub.mjs 说明)。
 *
 * 运行:cd packages/desktop && node --import tsx --test test/desktopDeepLinkWindowsRegistration.test.ts
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

register(new URL("./support/stubResolver.mjs", import.meta.url));

const { registerDeepLinkProtocol } = await import("../src/main/desktopOAuthDeepLink.js");
const { stubApp } = await import("./support/electronStub.mjs");

const logger = {
  info: () => undefined,
  warn: () => undefined,
};

/** process.platform / process.argv / process.defaultApp 都需要可写覆盖。 */
async function withWindowsEnv(
  platform: string,
  env: { defaultApp?: boolean; argv?: string[] },
  body: () => Promise<void> | void,
): Promise<void> {
  const previousPlatform = process.platform;
  const previousArgv = process.argv;
  const previousDefaultApp = process.defaultApp;
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
    writable: true,
  });
  if (env.argv !== undefined) {
    Object.defineProperty(process, "argv", { value: env.argv, configurable: true, writable: true });
  }
  if (env.defaultApp !== undefined) {
    Object.defineProperty(process, "defaultApp", {
      value: env.defaultApp,
      configurable: true,
      writable: true,
    });
  }
  try {
    await body();
  } finally {
    Object.defineProperty(process, "platform", {
      value: previousPlatform,
      configurable: true,
      writable: true,
    });
    if (env.argv !== undefined) {
      Object.defineProperty(process, "argv", {
        value: previousArgv,
        configurable: true,
        writable: true,
      });
    }
    if (env.defaultApp !== undefined) {
      Object.defineProperty(process, "defaultApp", {
        value: previousDefaultApp,
        configurable: true,
        writable: true,
      });
    }
  }
}

test("win32 打包态注册把 URL 固定在 -- 之后", async () => {
  stubApp.resetProtocolClientCalls();
  await withWindowsEnv("win32", { defaultApp: false }, () => {
    registerDeepLinkProtocol(logger);
  });
  assert.equal(stubApp.protocolClientCalls.length, 1);
  const [call] = stubApp.protocolClientCalls;
  assert.equal(call.scheme, "zcode");
  assert.deepEqual(call.args, ["--"]);
});

test("win32 defaultApp 分支入口路径也带 -- 终止符", async () => {
  stubApp.resetProtocolClientCalls();
  await withWindowsEnv(
    "win32",
    { defaultApp: true, argv: [process.execPath, "/app/main/index.js"] },
    () => {
      registerDeepLinkProtocol(logger);
    },
  );
  assert.equal(stubApp.protocolClientCalls.length, 1);
  const [call] = stubApp.protocolClientCalls;
  // 当前宿主的平台路径规则仍生效，Windows 上根路径会规范化为盘符路径。
  assert.deepEqual(call.args, [resolve("/app/main/index.js"), "--"]);
});

test("非 win32 不插入 --(Linux 用 xdg %u,macOS 由 LaunchServices 传 URL)", async () => {
  stubApp.resetProtocolClientCalls();
  await withWindowsEnv("linux", { defaultApp: false }, () => {
    registerDeepLinkProtocol(logger);
  });
  assert.equal(stubApp.protocolClientCalls.length, 1);
  const [call] = stubApp.protocolClientCalls;
  // 非默认应用路径注册不传 args,语义与历史上游一致。
  assert.equal(call.args, undefined);
});

test("win32 注册参数顺序:终止符必须是最后一个参数", async () => {
  stubApp.resetProtocolClientCalls();
  await withWindowsEnv("win32", { defaultApp: false }, () => {
    registerDeepLinkProtocol(logger);
  });
  const [call] = stubApp.protocolClientCalls;
  assert.equal(call.args?.at(-1), "--");
});

test("隔离 E2E 不写入系统协议或 Explorer 入口", async () => {
  const previous = process.env.ZCODE_E2E_RUN_ID;
  process.env.ZCODE_E2E_RUN_ID = "ide-isolation";
  stubApp.resetProtocolClientCalls();
  try {
    registerDeepLinkProtocol(logger);
    assert.equal(stubApp.protocolClientCalls.length, 0);
    const { installWindowsOpenFolderContextMenu } =
      await import("../src/main/desktopWindowsOpenFolderContextMenu.js");
    await installWindowsOpenFolderContextMenu({
      platform: "win32",
      executablePath: "invalid-test-executable",
      argv: [],
      isDefaultApp: false,
      locale: "en-US",
      logger: {
        info: () => assert.fail("must not register"),
        warn: () => assert.fail("must not attempt registry write"),
      },
    });
  } finally {
    if (previous === undefined) delete process.env.ZCODE_E2E_RUN_ID;
    else process.env.ZCODE_E2E_RUN_ID = previous;
  }
});
