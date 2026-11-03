import assert from "node:assert/strict";
import { test } from "node:test";

import { createDesktopRendererCrashRecovery } from "../src/main/desktopRendererCrashRecovery.js";

function createHarness() {
  let destroyed = false;
  let reloadCount = 0;
  const warnings: Array<{ message: string; details?: unknown }> = [];
  const recovery = createDesktopRendererCrashRecovery({
    isWindowDestroyed: () => destroyed,
    reload: () => {
      reloadCount += 1;
    },
    logger: {
      warn: (message, details) => warnings.push({ message, details }),
    },
  });

  return {
    recovery,
    warnings,
    get reloadCount() {
      return reloadCount;
    },
    setDestroyed(value: boolean) {
      destroyed = value;
    },
  };
}

test("reloads the existing window after a crashed or out-of-memory renderer", () => {
  const harness = createHarness();

  assert.equal(harness.recovery.onRendererGone({ reason: "crashed", exitCode: -1 }), true);
  assert.equal(harness.recovery.onRendererGone({ reason: "oom", exitCode: 137 }), false);
  assert.equal(harness.reloadCount, 1);
  assert.equal(harness.warnings.length, 1);

  harness.recovery.onLoadFinished();
  assert.equal(harness.recovery.onRendererGone({ reason: "oom", exitCode: 137 }), true);
  assert.equal(harness.reloadCount, 2);
});

test("does not reload for normal exits or a destroyed window", () => {
  const harness = createHarness();

  assert.equal(harness.recovery.onRendererGone({ reason: "clean-exit", exitCode: 0 }), false);
  assert.equal(harness.recovery.onRendererGone({ reason: "killed", exitCode: 1 }), false);
  harness.setDestroyed(true);
  assert.equal(harness.recovery.onRendererGone({ reason: "crashed", exitCode: -1 }), false);
  assert.equal(harness.reloadCount, 0);
  assert.equal(harness.warnings.length, 0);
});

test("releases the reload guard after a main-frame load failure", () => {
  const harness = createHarness();

  assert.equal(harness.recovery.onRendererGone({ reason: "crashed", exitCode: -1 }), true);
  harness.recovery.onMainFrameLoadFailed();
  assert.equal(harness.recovery.onRendererGone({ reason: "crashed", exitCode: -1 }), true);
  assert.equal(harness.reloadCount, 2);
});

test("logs and permits a later recovery when reload throws synchronously", () => {
  let shouldThrow = true;
  let reloadCount = 0;
  const warnings: string[] = [];
  const recovery = createDesktopRendererCrashRecovery({
    isWindowDestroyed: () => false,
    reload: () => {
      reloadCount += 1;
      if (shouldThrow) throw new Error("reload unavailable");
    },
    logger: { warn: (message) => warnings.push(message) },
  });

  assert.equal(recovery.onRendererGone({ reason: "crashed", exitCode: -1 }), false);
  shouldThrow = false;
  assert.equal(recovery.onRendererGone({ reason: "crashed", exitCode: -1 }), true);
  assert.equal(reloadCount, 2);
  assert.equal(warnings.length, 3);
  assert.match(warnings[1]!, /reload failed/);
});
