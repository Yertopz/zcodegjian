import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_CONSOLE_ATTACH_PENDING_TTL_MS,
  consumeBrowserConsoleGuestAttach,
  isRegisteredBrowserConsolePartition,
  prepareBrowserConsoleGuestAttach,
  registerBrowserConsolePartition,
  resetBrowserConsolePartitionGuardForTest,
  unregisterBrowserConsolePartition,
} from "../src/main/browserConsole/browserConsolePartitionGuard.js";

const PARTITION = "persist:zcode-browser-inst-test";

test.beforeEach(() => {
  resetBrowserConsolePartitionGuardForTest();
});

test("registered console partitions require a one-time attach permit", () => {
  registerBrowserConsolePartition(PARTITION);
  assert.equal(isRegisteredBrowserConsolePartition(PARTITION), true);
  assert.equal(prepareBrowserConsoleGuestAttach({ windowId: 1, partition: PARTITION }), true);
  assert.equal(consumeBrowserConsoleGuestAttach({ windowId: 1, partition: PARTITION }), true);
  assert.equal(consumeBrowserConsoleGuestAttach({ windowId: 1, partition: PARTITION }), false);
});

test("unregistered partitions never receive a permit", () => {
  assert.equal(prepareBrowserConsoleGuestAttach({ windowId: 1, partition: PARTITION }), false);
  assert.equal(consumeBrowserConsoleGuestAttach({ windowId: 1, partition: PARTITION }), false);
});

test("a permit is bound to the window that requested it", () => {
  registerBrowserConsolePartition(PARTITION);
  assert.equal(prepareBrowserConsoleGuestAttach({ windowId: 1, partition: PARTITION }), true);
  assert.equal(consumeBrowserConsoleGuestAttach({ windowId: 2, partition: PARTITION }), false);
  assert.equal(consumeBrowserConsoleGuestAttach({ windowId: 1, partition: PARTITION }), true);
});

test("expired permits are rejected", () => {
  registerBrowserConsolePartition(PARTITION);
  const now = 10_000;
  assert.equal(prepareBrowserConsoleGuestAttach({ windowId: 1, partition: PARTITION, now }), true);
  assert.equal(
    consumeBrowserConsoleGuestAttach({
      windowId: 1,
      partition: PARTITION,
      now: now + BROWSER_CONSOLE_ATTACH_PENDING_TTL_MS + 1,
    }),
    false,
  );
});

test("permits collapse when the partition is unregistered", () => {
  registerBrowserConsolePartition(PARTITION);
  assert.equal(prepareBrowserConsoleGuestAttach({ windowId: 1, partition: PARTITION }), true);
  unregisterBrowserConsolePartition(PARTITION);
  assert.equal(consumeBrowserConsoleGuestAttach({ windowId: 1, partition: PARTITION }), false);
});
