import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "electron";
import type { BrowserInstanceRecord } from "@zcode/shared";
import { prepareBrowserInstanceSession } from "../src/main/browserConsole/browserInstanceSession.js";

function createInstance(): BrowserInstanceRecord {
  return {
    id: "inst-a",
    name: "Work",
    partition: "persist:zcode-browser-inst-inst-a",
    proxy: { mode: "inherit" },
    createdAt: 1,
    updatedAt: 1,
  };
}

function createDeps(events: string[]) {
  const session = { protocol: {} } as unknown as Session;
  return {
    getSession: (partition: string) => {
      events.push(`get:${partition}`);
      return session;
    },
    applyNetworkPolicy: async () => {
      events.push("network");
    },
    applyPermissionPolicy: async () => {
      events.push("permission");
    },
    installRestoreProtocol: () => {
      events.push("protocol");
    },
    registerPartition: (partition: string) => {
      events.push(`register:${partition}`);
    },
  };
}

test("prepares proxy, permissions and restore protocol before allowing attach", async () => {
  const events: string[] = [];
  const instance = createInstance();
  await prepareBrowserInstanceSession({
    instance,
    settings: {},
    permission: {},
    deps: createDeps(events),
  });
  assert.deepEqual(events, [
    `get:${instance.partition}`,
    "network",
    "permission",
    "protocol",
    `register:${instance.partition}`,
  ]);
});

test("does not register the partition when the network policy fails", async () => {
  const events: string[] = [];
  const deps = createDeps(events);
  deps.applyNetworkPolicy = async () => {
    events.push("network");
    throw new Error("proxy failed");
  };
  await assert.rejects(
    prepareBrowserInstanceSession({
      instance: createInstance(),
      settings: {},
      permission: {},
      deps,
    }),
    /proxy failed/,
  );
  assert.equal(
    events.some((event) => event.startsWith("register:")),
    false,
  );
});

test("does not register the partition when the permission policy fails", async () => {
  const events: string[] = [];
  const deps = createDeps(events);
  deps.applyPermissionPolicy = async () => {
    events.push("permission");
    throw new Error("permission failed");
  };
  await assert.rejects(
    prepareBrowserInstanceSession({
      instance: createInstance(),
      settings: {},
      permission: {},
      deps,
    }),
    /permission failed/,
  );
  assert.equal(
    events.some((event) => event.startsWith("protocol")),
    false,
  );
  assert.equal(
    events.some((event) => event.startsWith("register:")),
    false,
  );
});
