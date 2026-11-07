import { randomUUID } from "node:crypto";

type ProviderFetch = typeof globalThis.fetch;
type ProviderFetchInput = Parameters<ProviderFetch>[0];
type ProviderFetchInit = Parameters<ProviderFetch>[1];

/** Codex CLI 的 `originator` 值；只有这类请求需要补 Codex 专属请求体字段。 */
const CODEX_ORIGINATOR_HEADER = "originator";
const CODEX_ORIGINATOR = "codex_cli_rs";
const RESPONSE_STORE_FIELD = "store";
const RESPONSE_INCLUDE_FIELD = "include";
/** 无服务端留档时，回放推理只能靠随响应下发的加密推理内容。 */
const CODEX_REASONING_INCLUDE = "reasoning.encrypted_content";

export function createOpenAIResponsesJsonCompatFetch(baseFetch: ProviderFetch): ProviderFetch {
  return async (input, init) => {
    const response = await baseFetch(input, withCodexRequestDefaults(input, init));
    if (!response.ok || isEventStream(response)) {
      return response;
    }

    const body = await parseJsonObject(response);
    if (!body) {
      return response;
    }

    const normalized = normalizeOpenAIResponsesJson(body);
    if (!normalized) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");

    return new Response(JSON.stringify(normalized), {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

function normalizeOpenAIResponsesJson(value: unknown): Record<string, unknown> | undefined {
  const response = asRecord(value);
  if (!response || !Array.isArray(response.output)) {
    return undefined;
  }

  const responseId =
    typeof response.id === "string" && response.id.length > 0 ? response.id : undefined;
  let changed = false;
  const output = response.output.map((item) => {
    const message = asRecord(item);
    if (message?.type !== "message") {
      return item;
    }

    let normalizedMessage = message;
    if (message.id === undefined && responseId) {
      // 部分 Responses-compatible 服务在非流式 compact 响应里省略
      // message.id，AI SDK 会在读取正文前拒绝整个 HTTP 200 响应。
      normalizedMessage = {
        ...normalizedMessage,
        id: `msg_${randomUUID()}`,
      };
      changed = true;
    }

    if (!Array.isArray(message.content)) {
      return normalizedMessage;
    }

    let contentChanged = false;
    const content = message.content.map((itemContent) => {
      const outputText = asRecord(itemContent);
      if (outputText?.type !== "output_text" || outputText.annotations !== undefined) {
        return itemContent;
      }

      contentChanged = true;
      return { ...outputText, annotations: [] };
    });

    if (!contentChanged) {
      return normalizedMessage;
    }

    changed = true;
    return { ...normalizedMessage, content };
  });

  return changed ? { ...response, output } : undefined;
}

function isEventStream(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().includes("event-stream") === true;
}

/**
 * Codex 后端要求请求体对齐上游 Codex CLI 的两个字段：`store: false` 与
 * `include: ["reasoning.encrypted_content"]`（openai/codex `core/src/client.rs` 恒定写死）。
 * 原因是 ChatGPT 登录态账号不允许服务端留档，而 Responses 的默认语义是 `store: true`；
 * 一旦不留档，推理内容只能靠响应里下发的加密块回放，所以必须显式请求它。
 * 这里按 `originator` 头判定，只补 Codex 连接的请求体，不改其他 openai-responses 供应商的语义。
 */
function withCodexRequestDefaults(
  input: ProviderFetchInput,
  init: ProviderFetchInit,
): ProviderFetchInit {
  const body = init?.body;
  if (typeof body !== "string" || !isCodexRequest(input, init)) return init;

  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = asRecord(JSON.parse(body));
  } catch {
    return init;
  }
  if (!parsed || typeof parsed.model !== "string") {
    return init;
  }

  const withStore = withResponseStoreDisabled(parsed);
  const withInclude = withCodexReasoningInclude(withStore);
  return withInclude === parsed ? init : { ...init, body: JSON.stringify(withInclude) };
}

function withResponseStoreDisabled(body: Record<string, unknown>): Record<string, unknown> {
  if (body[RESPONSE_STORE_FIELD] === false) return body;
  return { ...body, [RESPONSE_STORE_FIELD]: false };
}

/**
 * 保留调用方已有的 `include` 项（其它 include 是 AI SDK 为 logprobs 等能力加的）。
 * 非数组形态不猜语义，原样发送。
 */
function withCodexReasoningInclude(body: Record<string, unknown>): Record<string, unknown> {
  const current = body[RESPONSE_INCLUDE_FIELD];
  if (current === undefined) {
    return { ...body, [RESPONSE_INCLUDE_FIELD]: [CODEX_REASONING_INCLUDE] };
  }
  if (!Array.isArray(current) || current.includes(CODEX_REASONING_INCLUDE)) return body;
  return { ...body, [RESPONSE_INCLUDE_FIELD]: [...current, CODEX_REASONING_INCLUDE] };
}

function isCodexRequest(input: ProviderFetchInput, init: ProviderFetchInit): boolean {
  const requestHeaders = input instanceof Request ? input.headers : undefined;
  const headers = new Headers(init?.headers ?? requestHeaders);
  return headers.get(CODEX_ORIGINATOR_HEADER) === CODEX_ORIGINATOR;
}

async function parseJsonObject(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    return asRecord(JSON.parse(await response.clone().text()));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
