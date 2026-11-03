import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE } from "@zcode/shared";
import {
  bindBrowserConsoleTabGuest,
  clearBrowserConsoleTabsForInstance,
  clearBrowserConsoleTabsForWindow,
  findBrowserConsoleTabByWebContentsId,
  getBrowserConsoleTab,
  isBrowserConsoleTabClosed,
  listBrowserConsoleTabs,
  registerBrowserConsoleTab,
  resetBrowserConsoleTabRegistryForTest,
  unregisterBrowserConsoleTab,
} from "../src/main/browserConsole/browserConsoleTabRegistry.js";

function withRegistry(run: () => void): void {
  try {
    run();
  } finally {
    resetBrowserConsoleTabRegistryForTest();
  }
}

test("register:同一个 tabId 变更实例/窗口视为冲突", () => {
  withRegistry(() => {
    assert.deepEqual(registerBrowserConsoleTab({ tabId: "t1", instanceId: "a", windowId: 1 }), {
      ok: true,
    });
    assert.deepEqual(registerBrowserConsoleTab({ tabId: "t1", instanceId: "a", windowId: 1 }), {
      ok: true,
    });
    assert.deepEqual(registerBrowserConsoleTab({ tabId: "t1", instanceId: "b", windowId: 1 }), {
      ok: false,
      error: "tab_conflict",
    });
    assert.deepEqual(registerBrowserConsoleTab({ tabId: "t1", instanceId: "a", windowId: 2 }), {
      ok: false,
      error: "tab_conflict",
    });
  });
});

test("register:每实例标签数有上限,另一个实例不受影响", () => {
  withRegistry(() => {
    for (let index = 0; index < MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE; index += 1) {
      assert.deepEqual(
        registerBrowserConsoleTab({ tabId: `t${index}`, instanceId: "a", windowId: 1 }),
        { ok: true },
      );
    }
    assert.deepEqual(
      registerBrowserConsoleTab({ tabId: "overflow", instanceId: "a", windowId: 1 }),
      {
        ok: false,
        error: "limit_reached",
      },
    );
    assert.deepEqual(registerBrowserConsoleTab({ tabId: "other", instanceId: "b", windowId: 1 }), {
      ok: true,
    });
  });
});

test("guest 绑定:webContentsId 反查 tab,换代后覆盖旧映射", () => {
  withRegistry(() => {
    registerBrowserConsoleTab({ tabId: "t1", instanceId: "a", windowId: 1 });
    bindBrowserConsoleTabGuest("t1", 11);
    assert.equal(findBrowserConsoleTabByWebContentsId(11)?.tabId, "t1");
    bindBrowserConsoleTabGuest("t1", 12);
    assert.equal(findBrowserConsoleTabByWebContentsId(11), undefined);
    assert.equal(findBrowserConsoleTabByWebContentsId(12)?.tabId, "t1");
    unregisterBrowserConsoleTab("t1");
    assert.equal(findBrowserConsoleTabByWebContentsId(12), undefined);
    assert.equal(getBrowserConsoleTab("t1"), undefined);
  });
});

test("关闭标记:拒绝 guest 销毁后的无意义重绑,重新登记后解除", () => {
  withRegistry(() => {
    registerBrowserConsoleTab({ tabId: "t1", instanceId: "a", windowId: 1 });
    assert.equal(isBrowserConsoleTabClosed("t1"), false);
    unregisterBrowserConsoleTab("t1");
    assert.equal(isBrowserConsoleTabClosed("t1"), true);
    registerBrowserConsoleTab({ tabId: "t1", instanceId: "a", windowId: 1 });
    assert.equal(isBrowserConsoleTabClosed("t1"), false);
  });
});

test("清理:按实例与按窗口只移除各自归属", () => {
  withRegistry(() => {
    registerBrowserConsoleTab({ tabId: "a1", instanceId: "a", windowId: 1 });
    registerBrowserConsoleTab({ tabId: "a2", instanceId: "a", windowId: 2 });
    registerBrowserConsoleTab({ tabId: "b1", instanceId: "b", windowId: 1 });
    assert.deepEqual(
      listBrowserConsoleTabs("a").map((tab) => tab.tabId),
      ["a1", "a2"],
    );
    assert.deepEqual(clearBrowserConsoleTabsForInstance("a"), ["a1", "a2"]);
    assert.equal(listBrowserConsoleTabs().length, 1);
    clearBrowserConsoleTabsForWindow(1);
    assert.equal(listBrowserConsoleTabs().length, 0);
  });
});
