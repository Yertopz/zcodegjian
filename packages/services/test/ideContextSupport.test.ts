import assert from "node:assert/strict";
import test from "node:test";
import { ensureIdeContextSupport } from "../src/zcode-agent/ideContextSupport.js";

test("IDE rejects old execution endpoints and does not cache failed checks", async () => {
  let calls = 0;
  let supported = false;
  const client = {
    request: async () => {
      calls++;
      return { ideContextV1: supported };
    },
  } as unknown as Parameters<typeof ensureIdeContextSupport>[0];
  await assert.rejects(ensureIdeContextSupport(client), /proto.ideContextUnsupported/);
  supported = true;
  await ensureIdeContextSupport(client);
  await ensureIdeContextSupport(client);
  assert.equal(calls, 2);
});
