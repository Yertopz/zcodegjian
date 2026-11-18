import assert from "node:assert/strict";
import test from "node:test";
import { createIdeTextSearchController } from "../src/ide-mode/ideTextSearchController.js";
import type { IFileService, WorkspaceTextSearchResult } from "@zcode/services";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const empty: WorkspaceTextSearchResult = {
  matches: [],
  searchedFiles: 1,
  skippedFiles: 0,
  truncated: false,
  cancelled: false,
};

test("新搜索作废旧响应，取消 RPC 固定原工作区身份；不把 AbortSignal 传到 Host", async () => {
  const requests: Parameters<IFileService["searchWorkspaceText"]>[0][] = [];
  const cancelled: Parameters<IFileService["cancelWorkspaceTextSearch"]>[0][] = [];
  const replies = [deferred<WorkspaceTextSearchResult>(), deferred<WorkspaceTextSearchResult>()];
  const controller = createIdeTextSearchController(
    {
      searchWorkspaceText: async (params) => {
        requests.push(params);
        return replies[requests.length - 1]!.promise;
      },
      cancelWorkspaceTextSearch: async (params) => {
        cancelled.push(params);
        return true;
      },
    },
    { rootPath: "/workspace", workspaceIdentity: "remote:one" },
  );
  controller.search("first", false);
  await Promise.resolve();
  controller.search("second", true);
  replies[1]!.resolve(empty);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getSnapshot().query, "second");
  replies[0]!.resolve({ ...empty, searchedFiles: 99 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getSnapshot().result?.searchedFiles, 1);
  assert.equal(cancelled[0]?.requestId, requests[0]?.requestId);
  assert.equal(cancelled[0]?.workspaceIdentity, "remote:one");
  assert.equal("signal" in requests[0]!, false);
  assert.equal(requests[1]?.caseSensitive, true);
});

test("修改关键词/关闭组件立即清空结果，迟到响应不通知；失败可用原关键词重试", async () => {
  const reply = deferred<WorkspaceTextSearchResult>();
  let calls = 0;
  const controller = createIdeTextSearchController(
    {
      searchWorkspaceText: async () => {
        if (++calls === 1) return reply.promise;
        throw Error("old host");
      },
      cancelWorkspaceTextSearch: async () => true,
    },
    { rootPath: "/workspace" },
  );
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => {
    notifications++;
  });
  controller.search("original", false);
  await Promise.resolve();
  controller.cancel();
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(controller.getSnapshot().busy, false);
  controller.dispose();
  const before = notifications;
  reply.resolve(empty);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications, before);
  unsubscribe();
  controller.search("original", false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getSnapshot().error, "failed");
  assert.equal(controller.getSnapshot().query, "original");
});
