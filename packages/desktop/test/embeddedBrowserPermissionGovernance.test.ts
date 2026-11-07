/**
 * 内置浏览器权限治理(F9,移植上游 v3.15.1)main 侧单测。
 *
 * 不依赖 electron 运行时:policy/store/sitePermissions/deviceOptions 都是纯逻辑
 * (electron 仅出现在类型位置);守卫与桥用最小 fake 对象。
 *
 * 运行:cd packages/desktop && node --import tsx --test test/embeddedBrowserPermissionGovernance.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import test from "node:test";

// embeddedBrowserPermissionUiBridge 静态导入 electron(运行时),桩经解析钩子注入。
register(new URL("./support/stubResolver.mjs", import.meta.url));

import {
  applyEmbeddedBrowserPermissionPolicy,
  originFromUrl,
} from "../src/main/embeddedBrowserPermissionPolicy.js";
import {
  clearEmbeddedBrowserSitePermissions,
  getEmbeddedBrowserSitePermission,
  getEmbeddedBrowserSitePermissionSnapshot,
  initEmbeddedBrowserSitePermissions,
  removeEmbeddedBrowserSitePermission,
  removeEmbeddedBrowserSitePermissionOrigin,
  removeEmbeddedBrowserSitePermissionsForPartition,
  resetEmbeddedBrowserSitePermissionsForTest,
  writeEmbeddedBrowserSitePermission,
} from "../src/main/embeddedBrowserSitePermissions.js";
import { createEmbeddedBrowserSitePermissionStore } from "../src/main/embeddedBrowserSitePermissionStore.js";
import { readDeviceOptions } from "../src/main/embeddedBrowserDeviceOptions.js";
import { installEmbeddedBrowserBluetoothDeviceGuard } from "../src/main/embeddedBrowserBluetoothGuard.js";

// uiBridge 静态导入 electron(运行时);桩必须在动态 import 之前注册(ESM 先 link 后 evaluate)。
const { parseEmbeddedBrowserPermissionResolveRequest } =
  await import("../src/main/embeddedBrowserPermissionUiBridge.js");

function createFakeLogger() {
  const logs: { level: string; message: string }[] = [];
  return {
    logs,
    info: (message: string) => logs.push({ level: "info", message }),
    warn: (message: string) => logs.push({ level: "warn", message }),
  };
}

interface FakeSession {
  decisions: { permission: string; granted: boolean }[];
  requestHandler: (
    wc: unknown,
    permission: string,
    cb: (ok: boolean) => void,
    details: unknown,
  ) => void;
  checkHandler: (wc: unknown, permission: string, origin: string) => boolean;
  devicePermissionHandler: () => boolean;
  displayMediaHandler: (req: unknown, cb: (r: unknown) => void) => void;
  deviceHandlers: Map<string, (event: unknown, details: unknown, cb: (v?: string) => void) => void>;
  setPermissionRequestHandler(handler: never): void;
  setPermissionCheckHandler(handler: never): void;
  setDevicePermissionHandler(handler: never): void;
  setDisplayMediaRequestHandler(handler: never): void;
  on(event: string, handler: unknown): void;
}

function createFakeSession(): FakeSession {
  const session: FakeSession = {
    decisions: [],
    requestHandler: () => undefined,
    checkHandler: () => false,
    devicePermissionHandler: () => true,
    displayMediaHandler: () => undefined,
    deviceHandlers: new Map(),
    setPermissionRequestHandler(handler: never) {
      session.requestHandler = handler;
    },
    setPermissionCheckHandler(handler: never) {
      session.checkHandler = handler;
    },
    setDevicePermissionHandler(handler: never) {
      session.devicePermissionHandler = handler;
    },
    setDisplayMediaRequestHandler(handler: never) {
      session.displayMediaHandler = handler;
    },
    on(event: string, handler: unknown) {
      session.deviceHandlers.set(event, handler as never);
    },
  };
  return session;
}

function fireRequest(
  fakeSession: FakeSession,
  permission: string,
  details: Record<string, unknown> = {},
) {
  return new Promise<void>((resolve) => {
    fakeSession.requestHandler(
      { id: 1, hostWebContents: { id: 9 } },
      permission,
      (granted: boolean) => {
        fakeSession.decisions.push({ permission, granted });
        resolve();
      },
      { requestingUrl: "https://example.com/page", ...details },
    );
  });
}

function fireCheck(fakeSession: FakeSession, permission: string, origin = "https://example.com") {
  return fakeSession.checkHandler({ id: 1 }, permission, origin);
}

test.afterEach(() => {
  resetEmbeddedBrowserSitePermissionsForTest();
});

// policy 内的 site permission 落盘是 fire-and-forget,删除临时目录前给在途的原子写留出
// 落定时间,并对竞态 ENOTEMPTY 重试。
async function removeDirWithPendingWrites(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

test("originFromUrl:正常 URL 取 origin,异常回退 unknown", () => {
  assert.equal(originFromUrl("https://example.com/a/b?x=1"), "https://example.com");
  assert.equal(originFromUrl(undefined), "unknown");
  assert.equal(originFromUrl("not a url"), "unknown");
});

test("readDeviceOptions:HID/USB/Serial/蓝牙字段统一映射,缺 deviceId 丢弃", () => {
  const options = readDeviceOptions([{ deviceId: "d1", productName: "HID Device", vendorId: 1 }]);
  assert.equal(options.length, 1);
  assert.equal(options[0]!.deviceId, "d1");
  assert.equal(options[0]!.name, "HID Device");
  assert.equal(options[0]!.vendorId, 1);
});

test("readDeviceOptions:非数组与无 id 条目返回空/跳过", () => {
  assert.deepEqual(readDeviceOptions(undefined), []);
  assert.deepEqual(readDeviceOptions([{ name: "no id" }]), []);
  assert.deepEqual(
    readDeviceOptions([{ portId: "p1", portName: "COM3" }]).map((o) => o.deviceId),
    ["p1"],
  );
});

test("store:load 读不到文件时返回空记录", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-f9-store-"));
  const store = createEmbeddedBrowserSitePermissionStore(join(dir, "site.json"));
  assert.deepEqual(await store.load(), {});
  await rm(dir, { recursive: true, force: true });
});

test("store:persist 原子写,坏 JSON/形状降级为空", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-f9-store-"));
  const filePath = join(dir, "site.json");
  const store = createEmbeddedBrowserSitePermissionStore(filePath);
  const records = {
    "persist:zcode-embedded-browser": { "https://a.example": { camera: "allow" as const } },
  };
  await store.persist(records);
  const raw = await readFile(filePath, "utf8");
  assert.ok(raw.includes("https://a.example"));

  const store2 = createEmbeddedBrowserSitePermissionStore(filePath);
  assert.deepEqual(await store2.load(), records);

  await writeFile(filePath, "{ broken json");
  assert.deepEqual(await store2.load(), {});
  await writeFile(filePath, JSON.stringify({ "https://a.example": "allow" }));
  assert.deepEqual(await store2.load(), {});
  await writeFile(filePath, JSON.stringify({ origin: { perm: "bogus" } }));
  assert.deepEqual(await store2.load(), {});

  await rm(dir, { recursive: true, force: true });
});

test("store:旧扁平结构迁移到默认实例 partition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-f9-store-legacy-"));
  const filePath = join(dir, "site.json");
  await writeFile(filePath, JSON.stringify({ "https://legacy.example": { camera: "deny" } }));
  const store = createEmbeddedBrowserSitePermissionStore(filePath);
  assert.deepEqual(await store.load(), {
    "persist:zcode-embedded-browser": { "https://legacy.example": { camera: "deny" } },
  });
  await rm(dir, { recursive: true, force: true });
});

test("store:persist 失败抛错,上层只降级不崩", async () => {
  const store = createEmbeddedBrowserSitePermissionStore(join("/nonexistent-dir-xyz", "site.json"));
  await assert.rejects(() => store.persist({}));
});

test("sitePermissions:写后同步可读,快照为深拷贝", async () => {
  const logger = createFakeLogger();
  await initEmbeddedBrowserSitePermissions({ logger });
  await writeEmbeddedBrowserSitePermission("https://a.example", "camera", "allow");
  assert.equal(getEmbeddedBrowserSitePermission("https://a.example", "camera"), "allow");
  const snapshot = getEmbeddedBrowserSitePermissionSnapshot();
  snapshot["https://a.example"]!.camera = "deny";
  assert.equal(getEmbeddedBrowserSitePermission("https://a.example", "camera"), "allow");
});

test("sitePermissions:ask 删条目,origin 重置与全清", async () => {
  const logger = createFakeLogger();
  await initEmbeddedBrowserSitePermissions({ logger });
  await writeEmbeddedBrowserSitePermission("https://a.example", "camera", "allow");
  await writeEmbeddedBrowserSitePermission("https://a.example", "geolocation", "deny");
  await removeEmbeddedBrowserSitePermission("https://a.example", "camera");
  assert.equal(getEmbeddedBrowserSitePermission("https://a.example", "camera"), undefined);
  assert.equal(getEmbeddedBrowserSitePermission("https://a.example", "geolocation"), "deny");
  await removeEmbeddedBrowserSitePermissionOrigin("https://a.example");
  assert.deepEqual(getEmbeddedBrowserSitePermissionSnapshot(), {});
  await writeEmbeddedBrowserSitePermission("https://b.example", "midi", "deny");
  await clearEmbeddedBrowserSitePermissions();
  assert.deepEqual(getEmbeddedBrowserSitePermissionSnapshot(), {});
});

test("sitePermissions:按 partition 隔离且可整段清理", async () => {
  const logger = createFakeLogger();
  await initEmbeddedBrowserSitePermissions({ logger });
  const partitionA = "persist:zcode-browser-inst-a";
  await writeEmbeddedBrowserSitePermission("https://a.example", "camera", "allow", partitionA);
  assert.equal(getEmbeddedBrowserSitePermission("https://a.example", "camera"), undefined);
  assert.equal(
    getEmbeddedBrowserSitePermission("https://a.example", "camera", partitionA),
    "allow",
  );
  assert.equal(
    getEmbeddedBrowserSitePermission("https://a.example", "camera", "persist:zcode-browser-inst-b"),
    undefined,
  );
  await removeEmbeddedBrowserSitePermissionsForPartition(partitionA);
  assert.equal(
    getEmbeddedBrowserSitePermission("https://a.example", "camera", partitionA),
    undefined,
  );
  resetEmbeddedBrowserSitePermissionsForTest();
});

test("sitePermissions:store 不可用时内存层照常,失败只 warn", async () => {
  const logger = createFakeLogger();
  const failingStore = {
    load: async () => {
      throw new Error("disk gone");
    },
    persist: async () => {
      throw new Error("disk gone");
    },
  };
  await initEmbeddedBrowserSitePermissions({ store: failingStore, logger });
  await writeEmbeddedBrowserSitePermission("https://a.example", "camera", "allow");
  assert.equal(getEmbeddedBrowserSitePermission("https://a.example", "camera"), "allow");
  assert.ok(logger.logs.some((entry) => entry.level === "warn"));
});

test("policy:白名单权限静默放行,未知权限 fail-closed", async () => {
  const logger = createFakeLogger();
  const fakeSession = createFakeSession();
  await applyEmbeddedBrowserPermissionPolicy(fakeSession as never, { logger });
  for (const permission of [
    "clipboard-sanitized-write",
    "fullscreen",
    "pointerLock",
    "mediaKeySystem",
  ]) {
    await fireRequest(fakeSession, permission);
    assert.equal(fakeSession.decisions.at(-1)?.granted, true, `${permission} 应白名单放行`);
    assert.equal(fireCheck(fakeSession, permission), true);
  }
  await fireRequest(fakeSession, "keyboard-layout-access");
  assert.equal(fakeSession.decisions.at(-1)?.granted, false);
  await fireRequest(fakeSession, "openExternal");
  assert.equal(fakeSession.decisions.at(-1)?.granted, false);
  assert.ok(
    logger.logs.some((entry) => entry.level === "warn"),
    "未知权限须 warn 日志",
  );
});

test("policy:无弹窗能力时敏感权限一律拒绝", async () => {
  const logger = createFakeLogger();
  const fakeSession = createFakeSession();
  await applyEmbeddedBrowserPermissionPolicy(fakeSession as never, { logger });
  await fireRequest(fakeSession, "media", { mediaTypes: ["video"] });
  assert.equal(fakeSession.decisions.at(-1)?.granted, false);
  await fireRequest(fakeSession, "geolocation");
  assert.equal(fakeSession.decisions.at(-1)?.granted, false);
  assert.equal(fireCheck(fakeSession, "media"), false);
});

test("policy:allow-always 持久化,block-always 持久拒绝,命中记录不再弹窗", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-f9-policy-"));
  const store = createEmbeddedBrowserSitePermissionStore(join(dir, "site.json"));
  const logger = createFakeLogger();
  const fakeSession = createFakeSession();
  const promptCalls: { origin: string; permission: string }[] = [];
  await applyEmbeddedBrowserPermissionPolicy(fakeSession as never, {
    logger,
    store,
    async prompt(request) {
      promptCalls.push({ origin: request.origin, permission: request.permission });
      return request.permission === "media" ? "allow-always" : "block-always";
    },
  });

  await fireRequest(fakeSession, "media", { mediaTypes: ["video"] });
  assert.equal(fakeSession.decisions.at(-1)?.granted, true);
  assert.equal(getEmbeddedBrowserSitePermission("https://example.com", "media"), "allow");

  promptCalls.length = 0;
  await fireRequest(fakeSession, "media", { mediaTypes: ["video"] });
  assert.equal(fakeSession.decisions.at(-1)?.granted, true);
  assert.equal(promptCalls.length, 0);
  assert.equal(fireCheck(fakeSession, "media"), true);

  await fireRequest(fakeSession, "geolocation");
  assert.equal(fakeSession.decisions.at(-1)?.granted, false);
  assert.equal(getEmbeddedBrowserSitePermission("https://example.com", "geolocation"), "deny");
  promptCalls.length = 0;
  await fireRequest(fakeSession, "geolocation");
  assert.equal(promptCalls.length, 0);
  assert.equal(fireCheck(fakeSession, "geolocation"), false);

  await removeDirWithPendingWrites(dir);
});

test("policy:allow-session 只写入内存 sessionAllow", async () => {
  const logger = createFakeLogger();
  const fakeSession = createFakeSession();
  await applyEmbeddedBrowserPermissionPolicy(fakeSession as never, {
    logger,
    async prompt() {
      return "allow-session";
    },
  });
  await fireRequest(fakeSession, "midi");
  assert.equal(fakeSession.decisions.at(-1)?.granted, true);
  assert.equal(getEmbeddedBrowserSitePermission("https://example.com", "midi"), undefined);
  assert.equal(fireCheck(fakeSession, "midi"), true);
});

test("policy:同 origin+权限并发请求只弹一个(inflight 去重)", async () => {
  const logger = createFakeLogger();
  const fakeSession = createFakeSession();
  let promptCount = 0;
  let resolvePrompt: (action: "allow-always") => void = () => undefined;
  const promptPromise = new Promise<"allow-always">((resolve) => {
    resolvePrompt = resolve;
  });
  await applyEmbeddedBrowserPermissionPolicy(fakeSession as never, {
    logger,
    async prompt() {
      promptCount += 1;
      return promptPromise;
    },
  });
  const first = fireRequest(fakeSession, "media");
  const second = fireRequest(fakeSession, "media");
  const third = fireRequest(fakeSession, "media");
  resolvePrompt("allow-always");
  await Promise.all([first, second, third]);
  assert.equal(promptCount, 1);
  assert.equal(fakeSession.decisions.filter((d) => d.granted).length, 3);
});

test("policy:select-usb-device/serial 无选择器时取消(阻断静默授权)", async () => {
  const logger = createFakeLogger();
  const fakeSession = createFakeSession();
  await applyEmbeddedBrowserPermissionPolicy(fakeSession as never, { logger });
  const handler = fakeSession.deviceHandlers.get("select-usb-device");
  assert.ok(handler, "select-usb-device 监听已注册");
  const result = await new Promise((resolve) => {
    handler!({}, { deviceList: [{ deviceId: "u1" }] }, resolve);
  });
  assert.equal(result, undefined);
  const serialHandler = fakeSession.deviceHandlers.get("select-serial-port");
  assert.ok(serialHandler);
  const serialResult = await new Promise((resolve) => {
    serialHandler!({}, [{ portId: "s1" }], { hostWebContents: { id: 3 } }, resolve);
  });
  assert.equal(serialResult, "");
  assert.equal(fakeSession.devicePermissionHandler(), true, "设备类 check 放行到 chooser");
});

test("policy:设备选择器返回 deviceId,后续 fire 只热更新列表", async () => {
  const logger = createFakeLogger();
  const fakeSession = createFakeSession();
  const updatedLists: number[] = [];
  await applyEmbeddedBrowserPermissionPolicy(fakeSession as never, {
    logger,
    devicePicker: () => ({
      result: Promise.resolve({ deviceId: "pick-1" }),
      updateDevices: (devices) => updatedLists.push(devices.length),
    }),
  });
  const handler = fakeSession.deviceHandlers.get("select-usb-device")!;
  const first = new Promise((resolve) =>
    handler({}, { deviceList: [{ deviceId: "u1" }] }, resolve),
  );
  // 同一请求的后续 fire 只热更新设备列表,不再结算新 callback。
  const second = new Promise((resolve) => setTimeout(() => resolve(undefined), 30));
  handler({}, { deviceList: [{ deviceId: "u1" }, { deviceId: "u2" }] }, () => undefined);
  assert.equal(await first, "pick-1");
  await second;
  assert.deepEqual(updatedLists, [2]);
});

test("policy:displayMedia 无源选择器时默认拒绝", async () => {
  const logger = createFakeLogger();
  const fakeSession = createFakeSession();
  await applyEmbeddedBrowserPermissionPolicy(fakeSession as never, { logger });
  const result = await new Promise((resolve) => {
    fakeSession.displayMediaHandler({ frame: { url: "https://example.com" } }, resolve);
  });
  assert.deepEqual(result, {});
});

test("policy:onDisplayMediaRequest 转发源选择", async () => {
  const logger = createFakeLogger();
  const fakeSession = createFakeSession();
  let bridgeCalled = false;
  await applyEmbeddedBrowserPermissionPolicy(fakeSession as never, {
    logger,
    onDisplayMediaRequest: (_input, callback) => {
      bridgeCalled = true;
      callback({ video: { id: "screen:0:0" } });
    },
  });
  const result = await new Promise((resolve) => {
    fakeSession.displayMediaHandler({ frame: { url: "https://example.com" } }, resolve);
  });
  assert.equal(bridgeCalled, true);
  assert.deepEqual(result, { video: { id: "screen:0:0" } });
});

test("policy:initializeStore=false 复用已加载的全局站点同意记录", async () => {
  const logger = createFakeLogger();
  initEmbeddedBrowserSitePermissions({ logger });
  await writeEmbeddedBrowserSitePermission("https://a.example", "media", "allow");
  const fakeSession = createFakeSession();
  await applyEmbeddedBrowserPermissionPolicy(fakeSession as never, {
    logger,
    initializeStore: false,
  });
  assert.equal(getEmbeddedBrowserSitePermission("https://a.example", "media"), "allow");
  const granted = await new Promise<boolean>((resolve) => {
    fakeSession.requestHandler({ id: 1, hostWebContents: { id: 9 } }, "media", resolve, {
      requestingUrl: "https://a.example/page",
    });
  });
  assert.equal(granted, true);
});

test("bluetoothGuard:无选择器时回调空串(取消),不静默授权", () => {
  const logs: string[] = [];
  const listeners = new Map<string, Function>();
  const guest = {
    getURL: () => "https://example.com",
    id: 5,
    on: (event: string, handler: Function) => listeners.set(event, handler),
  };
  installEmbeddedBrowserBluetoothDeviceGuard(guest, (message: string) => logs.push(message), {});
  const handler = listeners.get("select-bluetooth-device")!;
  let deviceCallback: string | undefined;
  handler({ preventDefault: () => undefined }, [{ deviceId: "b1" }], (d: string) => {
    deviceCallback = d;
  });
  assert.equal(deviceCallback, "");
  assert.ok(logs.some((line) => line.includes("decision=denied")));
});

test("bluetoothGuard:选择器返回设备 id,后续 fire 热更新", async () => {
  const listeners = new Map<string, Function>();
  const guest = {
    getURL: () => "https://example.com",
    id: 5,
    on: (event: string, handler: Function) => listeners.set(event, handler),
  };
  let updateCount = 0;
  installEmbeddedBrowserBluetoothDeviceGuard(guest, () => undefined, {
    devicePicker: () => ({
      result: Promise.resolve({ deviceId: "bt-9" }),
      updateDevices: () => {
        updateCount += 1;
      },
    }),
  });
  const handler = listeners.get("select-bluetooth-device")!;
  const first = new Promise((resolve) =>
    handler({ preventDefault: () => undefined }, [{ deviceId: "b1" }], resolve),
  );
  handler(
    { preventDefault: () => undefined },
    [{ deviceId: "b1" }, { deviceId: "b2" }],
    () => undefined,
  );
  assert.equal(await first, "bt-9");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(updateCount, 1);
});

test("parseResolve:畸形与不完整载荷一律拒绝", () => {
  assert.equal(parseEmbeddedBrowserPermissionResolveRequest(null), null);
  assert.equal(parseEmbeddedBrowserPermissionResolveRequest({ requestId: "x" }), null);
  assert.equal(
    parseEmbeddedBrowserPermissionResolveRequest({
      requestId: "x",
      resolution: { action: "bogus" },
    }),
    null,
  );
  assert.equal(
    parseEmbeddedBrowserPermissionResolveRequest({
      requestId: "x",
      resolution: { action: "share-screen" },
    }),
    null,
  );
  assert.equal(
    parseEmbeddedBrowserPermissionResolveRequest({
      requestId: "x",
      resolution: { action: "select-device" },
    }),
    null,
  );
});

test("parseResolve:合法载荷解析", () => {
  const parsed = parseEmbeddedBrowserPermissionResolveRequest({
    requestId: "req-1",
    resolution: { action: "allow-always" },
  });
  assert.equal(parsed?.requestId, "req-1");
  assert.deepEqual(parsed?.resolution, { action: "allow-always" });

  const share = parseEmbeddedBrowserPermissionResolveRequest({
    requestId: "req-2",
    resolution: { action: "share-screen", sourceId: "screen:0:0" },
  });
  assert.equal(share?.resolution.action, "share-screen");
  const device = parseEmbeddedBrowserPermissionResolveRequest({
    requestId: "req-3",
    resolution: { action: "select-device", deviceId: "d-9" },
  });
  assert.equal(device?.resolution.action, "select-device");
});
