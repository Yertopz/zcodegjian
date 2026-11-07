import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAIResponsesJsonCompatFetch } from "../src/model/openai-responses-json-compat.js";

/**
 * Codex 连接需要请求体带上游 Codex CLI 写死的两个字段（openai/codex `core/src/client.rs`）：
 * `store: false` 与 `include: ["reasoning.encrypted_content"]` —— ChatGPT 登录态账号不允许
 * 服务端留档，而 Responses 的默认语义是 `store: true`；不留档时推理只能靠响应下发的加密块回放。
 *
 * 这里钉三件事：
 * ① 带 `originator: codex_cli_rs` 的请求补上这两个字段，其余字段原样保留；
 * ② 没有该头的 openai-responses 连接请求体一个字节都不改 —— 否则会改变
 *    其他供应商的语义（有的供应商会把 `store` 当未知字段直接 400）；
 * ③ 已经齐备的请求体不重复序列化，调用方自带的 `include` 项不被覆盖。
 *
 * 运行：
 *   cd apps/zcode-cli/packages/adapters && node --import tsx \
 *     --import ../../../../packages/services/test/support/zcodeSourceResolver.mjs \
 *     --test test/openaiResponsesJsonCompat.test.ts
 */

const CODEX_ORIGINATOR = "codex_cli_rs";
const CODEX_REASONING_INCLUDE = "reasoning.encrypted_content";

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function createFetchStub(): {
  readonly fetch: typeof globalThis.fetch;
  readonly captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];
  const fetchStub = async (input: any, init?: RequestInit): Promise<Response> => {
    captured.push({ url: String(input), init });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchStub as typeof globalThis.fetch, captured };
}

function codexBody(): string {
  return JSON.stringify({
    model: "gpt-6.1-sol",
    input: [{ role: "user", content: "hi" }],
    stream: true,
  });
}

test("Codex 请求：按 originator 补 store:false 与加密推理 include，其余字段不变", async () => {
  const stub = createFetchStub();
  const compatFetch = createOpenAIResponsesJsonCompatFetch(stub.fetch);

  await compatFetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer token-value",
      originator: CODEX_ORIGINATOR,
    },
    body: codexBody(),
  });

  assert.equal(stub.captured.length, 1);
  const body = JSON.parse(String(stub.captured[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(body.store, false);
  assert.deepEqual(body.include, [CODEX_REASONING_INCLUDE]);
  assert.equal(body.model, "gpt-6.1-sol");
  assert.equal(body.stream, true);
  assert.deepEqual(body.input, [{ role: "user", content: "hi" }]);
  // 请求头原样保留：`chatgpt-account-id` / `originator` 是 Codex 后端认的鉴权上下文。
  const headers = new Headers(stub.captured[0]?.init?.headers);
  assert.equal(headers.get("originator"), CODEX_ORIGINATOR);
  assert.equal(headers.get("authorization"), "Bearer token-value");
});

test("非 Codex 请求：请求体一个字节都不改", async () => {
  const stub = createFetchStub();
  const compatFetch = createOpenAIResponsesJsonCompatFetch(stub.fetch);
  const original = codexBody();

  await compatFetch("https://api.example.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer other" },
    body: original,
  });

  assert.equal(String(stub.captured[0]?.init?.body), original);
});

test("齐备的 Codex 请求体不重复序列化", async () => {
  const stub = createFetchStub();
  const compatFetch = createOpenAIResponsesJsonCompatFetch(stub.fetch);
  const original = JSON.stringify({
    model: "gpt-6.1-sol",
    stream: true,
    store: false,
    include: [CODEX_REASONING_INCLUDE],
  });

  await compatFetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: { originator: CODEX_ORIGINATOR },
    body: original,
  });

  assert.equal(String(stub.captured[0]?.init?.body), original);
});

test("Codex 请求：已有 include 时追加推理项，不覆盖调用方其他 include", async () => {
  const stub = createFetchStub();
  const compatFetch = createOpenAIResponsesJsonCompatFetch(stub.fetch);

  await compatFetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: { originator: CODEX_ORIGINATOR },
    body: JSON.stringify({
      model: "gpt-6.1-sol",
      stream: true,
      store: false,
      include: ["message.output_text.logprobs"],
    }),
  });

  const body = JSON.parse(String(stub.captured[0]?.init?.body)) as Record<string, unknown>;
  assert.deepEqual(body.include, ["message.output_text.logprobs", CODEX_REASONING_INCLUDE]);
  assert.equal(body.store, false);
});

test("非数组 include 不猜语义：只补 store，include 原样发回", async () => {
  const stub = createFetchStub();
  const compatFetch = createOpenAIResponsesJsonCompatFetch(stub.fetch);

  await compatFetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: { originator: CODEX_ORIGINATOR },
    body: JSON.stringify({ model: "gpt-6.1-sol", stream: true, include: "reasoning" }),
  });

  const body = JSON.parse(String(stub.captured[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(body.store, false);
  assert.equal(body.include, "reasoning");
});

test("响应侧兼容仍然生效：非 SSE 的 JSON 响应原样交回", async () => {
  const compatFetch = createOpenAIResponsesJsonCompatFetch(createFetchStub().fetch);
  const response = await compatFetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: { originator: CODEX_ORIGINATOR },
    body: codexBody(),
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "{}");
});
