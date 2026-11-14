import assert from "node:assert/strict";
import test from "node:test";
import { queryFileChangesWithRecovery } from "../src/v4/fileChangesQuery.js";

const base = { revision: 1, logEpoch: "epoch" };
function fixture() {
  const listeners = new Set<() => void>();
  let state: { status: "live" | "closed" | "error"; snapshot: typeof base } = {
    status: "live",
    snapshot: base,
  };
  let recoveries = 0;
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    recoverFromStaleAuthority() {
      recoveries++;
    },
    update(next: typeof state) {
      state = next;
      for (const listener of listeners) listener();
    },
    get recoveries() {
      return recoveries;
    },
    get listeners() {
      return listeners.size;
    },
  };
}
test("文件摘要过期后等待权威版本推进，再重查一次并清理订阅", async () => {
  const store = fixture();
  const revisions: number[] = [];
  const request = queryFileChangesWithRecovery(base, store, async (authority) => {
    revisions.push(authority.revision);
    if (revisions.length === 1) throw Error("proto.staleRevision");
    return "patch";
  });
  await Promise.resolve();
  assert.equal(store.recoveries, 1);
  store.update({ status: "live", snapshot: base });
  assert.deepEqual(revisions, [1]);
  store.update({ status: "live", snapshot: { ...base, revision: 2 } });
  assert.equal(await request, "patch");
  assert.deepEqual(revisions, [1, 2]);
  assert.equal(store.listeners, 0);
});
test("文件摘要恢复失败、会话释放或 epoch 换代，不跨代重试", async () => {
  for (const next of [
    { status: "closed" as const, snapshot: base },
    { status: "error" as const, snapshot: base },
    { status: "live" as const, snapshot: { revision: 2, logEpoch: "other" } },
  ]) {
    const store = fixture();
    let calls = 0;
    const request = queryFileChangesWithRecovery(base, store, async () => {
      calls++;
      throw Error("proto.staleRevision");
    });
    await Promise.resolve();
    store.update(next);
    await assert.rejects(request, /staleRevision/);
    assert.equal(calls, 1);
    assert.equal(store.listeners, 0);
  }
});
test("已收到新版本直接使用；再次过期不无限重查", async () => {
  const store = fixture();
  store.update({ status: "live", snapshot: { ...base, revision: 2 } });
  let calls = 0;
  await assert.rejects(
    queryFileChangesWithRecovery(base, store, async () => {
      calls++;
      throw Error("proto.staleRevision");
    }),
    /staleRevision/,
  );
  assert.equal(calls, 2);
  assert.equal(store.recoveries, 0);
  assert.equal(store.listeners, 0);
});
