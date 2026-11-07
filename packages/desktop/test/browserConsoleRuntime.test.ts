import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Session } from "electron";
import type { ProxyConfig } from "electron";
import { DEFAULT_BROWSER_INSTANCE_ID, DEFAULT_BROWSER_INSTANCE_PARTITION } from "@zcode/shared";
import {
  getBrowserConsoleRuntime,
  initializeBrowserConsoleRuntime,
  resetBrowserConsoleRuntimeForTest,
} from "../src/main/browserConsole/browserConsoleRuntime.js";
import {
  registerBrowserConsoleTab,
  resetBrowserConsoleTabRegistryForTest,
} from "../src/main/browserConsole/browserConsoleTabRegistry.js";

interface FakeCalls {
  proxy: ProxyConfig[];
  permissions: unknown[];
  restoreProtocols: unknown[];
  cleared: string[];
  closeConnections: number;
}

function createHarness() {
  const calls: FakeCalls = {
    proxy: [],
    permissions: [],
    restoreProtocols: [],
    cleared: [],
    closeConnections: 0,
  };
  const sessions = new Map<string, Session>();
  const fromPartition = (partition: string): Session => {
    const existing = sessions.get(partition);
    if (existing) return existing;
    const fake = {
      setProxy: async (config: ProxyConfig) => {
        calls.proxy.push(config);
      },
      closeAllConnections: async () => {
        calls.closeConnections += 1;
      },
      setCertificateVerifyProc: () => undefined,
      protocol: {},
      clearCache: async () => undefined,
      clearStorageData: async () => undefined,
      cookies: {
        set: async () => undefined,
        flushStore: async () => undefined,
      },
    } as unknown as Session;
    sessions.set(partition, fake);
    return fake;
  };
  return {
    calls,
    sessions,
    internals: {
      fromPartition,
      applyPermissionPolicy: async (input: { session: Session; permission: unknown }) => {
        calls.permissions.push(input.permission);
      },
      installRestoreProtocol: (protocol: unknown) => {
        calls.restoreProtocols.push(protocol);
      },
      clearData: async (input: { targetSession: Session }) => {
        const partition = [...sessions.entries()].find(
          ([, value]) => value === input.targetSession,
        );
        calls.cleared.push(partition?.[0] ?? "unknown");
        return { success: true };
      },
    },
  };
}

async function withRuntime(
  run: (input: {
    calls: FakeCalls;
    runtime: ReturnType<typeof getBrowserConsoleRuntime>;
  }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-browser-console-runtime-"));
  const harness = createHarness();
  try {
    await initializeBrowserConsoleRuntime({
      userDataPath: dir,
      logger: { info: () => undefined, warn: () => undefined },
      settings: {},
      permission: {},
      now: () => 5_000,
      idFactory: (() => {
        let next = 0;
        return () => `inst-${++next}`;
      })(),
      internal: harness.internals,
    });
    await run({ calls: harness.calls, runtime: getBrowserConsoleRuntime() });
  } finally {
    resetBrowserConsoleRuntimeForTest();
    resetBrowserConsoleTabRegistryForTest();
    await rm(dir, { recursive: true, force: true });
  }
}

test("create prepares the session and registers a one-time attach permit", async () => {
  await withRuntime(async ({ calls, runtime }) => {
    const created = await runtime.create({
      name: "Work",
      proxy: { mode: "fixed", protocol: "socks5", host: "10.0.0.8", port: 1080 },
    });
    assert.equal(created.ok, true);
    assert.ok(created.instance);
    assert.equal(created.instance.partition, "persist:zcode-browser-inst-inst-1");

    assert.deepEqual(calls.proxy, [
      { mode: "fixed_servers", proxyRules: "socks5://10.0.0.8:1080" },
    ]);
    assert.equal(calls.closeConnections, 1);
    assert.equal(calls.permissions.length, 1);
    assert.equal(calls.restoreProtocols.length, 1);

    assert.deepEqual(
      registerBrowserConsoleTab({
        tabId: "tab-1",
        instanceId: created.instance.id,
        windowId: 7,
      }),
      { ok: true },
    );
    const prepared = await runtime.prepareGuestAttach({
      tabId: "tab-1",
      instanceId: created.instance.id,
      windowId: 7,
    });
    assert.equal(prepared.ok, true);
    // 未登记的 tabId 不能借道其它实例的 partition。
    assert.deepEqual(
      await runtime.prepareGuestAttach({
        tabId: "tab-unknown",
        instanceId: created.instance.id,
        windowId: 7,
      }),
      { ok: false, error: "tab_conflict" },
    );
    assert.equal(runtime.list().length, 2);
  });
});

test("invalid fixed proxy is rejected before persisting", async () => {
  await withRuntime(async ({ runtime }) => {
    const created = await runtime.create({
      name: "Bad",
      proxy: { mode: "fixed", protocol: "http", host: "bad host", port: 8080 },
    });
    assert.deepEqual(created, { ok: false, error: "invalid_input" });
    assert.equal(runtime.list().length, 1);
  });
});

test("update re-applies the proxy and delete clears instance data", async () => {
  await withRuntime(async ({ calls, runtime }) => {
    const created = await runtime.create({ name: "Work" });
    assert.ok(created.instance);
    const id = created.instance.id;
    const permissionsBefore = calls.permissions.length;
    const closeConnectionsBefore = calls.closeConnections;

    const updated = await runtime.update({
      id,
      proxy: { mode: "direct" },
    });
    assert.equal(updated.ok, true);
    assert.deepEqual(calls.proxy.at(-1), { mode: "direct" });
    // 改代理只重装网络策略，不能重跑权限装配（否则 select-* 监听会叠加）。
    assert.equal(calls.permissions.length, permissionsBefore);
    assert.equal(calls.closeConnections, closeConnectionsBefore + 1);

    const removed = await runtime.remove(id);
    assert.deepEqual(removed, { ok: true });
    assert.deepEqual(calls.cleared, [created.instance.partition]);
    assert.equal(
      runtime.list().some((instance) => instance.id === id),
      false,
    );
  });
});

test("default instance cannot be deleted or given a custom proxy", async () => {
  await withRuntime(async ({ runtime }) => {
    assert.deepEqual(await runtime.remove(DEFAULT_BROWSER_INSTANCE_ID), {
      ok: false,
      error: "default_immutable",
    });
    assert.deepEqual(
      await runtime.update({
        id: DEFAULT_BROWSER_INSTANCE_ID,
        proxy: { mode: "direct" },
      }),
      { ok: false, error: "default_immutable" },
    );
    registerBrowserConsoleTab({
      tabId: "tab-default",
      instanceId: DEFAULT_BROWSER_INSTANCE_ID,
      windowId: 1,
    });
    const prepared = await runtime.prepareGuestAttach({
      tabId: "tab-default",
      instanceId: DEFAULT_BROWSER_INSTANCE_ID,
      windowId: 1,
    });
    assert.equal(prepared.ok, true);
    const defaultInstance = runtime
      .list()
      .find((instance) => instance.id === DEFAULT_BROWSER_INSTANCE_ID);
    assert.equal(defaultInstance?.partition, DEFAULT_BROWSER_INSTANCE_PARTITION);
  });
});
