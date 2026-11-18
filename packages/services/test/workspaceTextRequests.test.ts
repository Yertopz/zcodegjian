import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceTextRequests } from "../src/zcode-agent/workspaceTextRequests.js";

test("文本请求先登记再路由；等待路由期间取消可阻止模型启动，且不能跨工作区取消", () => {
  const requests = new WorkspaceTextRequests();
  const handle = requests.begin("remote-a", "operation-1");
  assert.equal(requests.cancel("remote-b", "operation-1"), false);
  assert.equal(handle.signal.aborted, false);
  assert.equal(requests.cancel("remote-a", "operation-1"), true);
  assert.throws(() => handle.signal.throwIfAborted(), { name: "AbortError" });
  assert.equal(requests.cancel("remote-a", "operation-1"), true);
  handle.dispose();
  assert.equal(requests.cancel("remote-a", "operation-1"), false);
});
test("直接服务 signal 仍可用；完成后释放身份，不接受已在途的重复操作", () => {
  const requests = new WorkspaceTextRequests();
  const external = new AbortController();
  const handle = requests.begin("local", "operation-2", external.signal);
  assert.throws(() => requests.begin("local", "operation-2"));
  external.abort();
  assert.equal(handle.signal.aborted, true);
  handle.dispose();
  const next = requests.begin("local", "operation-2");
  assert.equal(next.signal.aborted, false);
  next.dispose();
  assert.throws(() => requests.begin("local", "bad", {} as AbortSignal), /in-process only/);
});
