import assert from "node:assert/strict";
import test from "node:test";
import {
  clearBrowserConsoleAgentBindingsForInstance,
  clearBrowserConsoleAgentBindingsForWindow,
  getBrowserConsoleAgentBinding,
  listBrowserConsoleAgentBindings,
  resetBrowserConsoleAgentBindingsForTest,
  setBrowserConsoleAgentBinding,
} from "../src/main/browserConsole/browserConsoleAgentBinding.js";

function withBindings(run: () => void): void {
  try {
    run();
  } finally {
    resetBrowserConsoleAgentBindingsForTest();
  }
}

test("binding:按 window + workspace + session 区分, null 解除绑定", () => {
  withBindings(() => {
    setBrowserConsoleAgentBinding({
      windowId: 1,
      workspaceKey: "/w",
      sessionId: "s1",
      instanceId: "a",
    });
    assert.equal(
      getBrowserConsoleAgentBinding({ windowId: 1, workspaceKey: "/w", sessionId: "s1" })
        ?.instanceId,
      "a",
    );
    assert.equal(
      getBrowserConsoleAgentBinding({ windowId: 2, workspaceKey: "/w", sessionId: "s1" }),
      undefined,
    );
    assert.equal(
      getBrowserConsoleAgentBinding({ windowId: 1, workspaceKey: "/w", sessionId: "s2" }),
      undefined,
    );
    setBrowserConsoleAgentBinding({
      windowId: 1,
      workspaceKey: "/w",
      sessionId: "s1",
      instanceId: null,
    });
    assert.equal(
      getBrowserConsoleAgentBinding({ windowId: 1, workspaceKey: "/w", sessionId: "s1" }),
      undefined,
    );
  });
});

test("binding:实例删除与窗口关闭按归属清理", () => {
  withBindings(() => {
    setBrowserConsoleAgentBinding({
      windowId: 1,
      workspaceKey: "/w",
      sessionId: "s1",
      instanceId: "a",
    });
    setBrowserConsoleAgentBinding({
      windowId: 1,
      workspaceKey: "/w",
      sessionId: "s2",
      instanceId: "b",
    });
    setBrowserConsoleAgentBinding({
      windowId: 2,
      workspaceKey: "/w",
      sessionId: "s3",
      instanceId: "a",
    });
    clearBrowserConsoleAgentBindingsForInstance("a");
    assert.deepEqual(
      listBrowserConsoleAgentBindings().map((binding) => binding.sessionId),
      ["s2"],
    );
    clearBrowserConsoleAgentBindingsForWindow(1);
    assert.equal(listBrowserConsoleAgentBindings().length, 0);
  });
});
