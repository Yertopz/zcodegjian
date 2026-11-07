import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loginCodexCli,
  parseCodexProxyUrl,
} from "../src/codex-login.js";
import {
  CODEX_API_BASE_URL,
  CODEX_FEDRAMP_API_BASE_URL,
  CODEX_PROVIDER_ID,
  readCodexCredentials,
  readCodexModelDescriptors,
} from "../src/codex-credentials.js";

/**
 * Codex 登录接入的证据用例。
 *
 * 钉三件事：代理字符串的边界、Codex 自己的凭据/模型目录能不能被如实读出、
 * 以及一次 `zcode login codex` 之后落盘的连接事实是否足以让模型请求走该代理。
 * 运行：node --import tsx --import ../../../../packages/services/test/support/zcodeSourceResolver.mjs \
 *   --test apps/zcode-cli/packages/bootstrap/test/codexLogin.test.ts
 */

const ACCOUNT_ID = "account-test-0001";
const ACCESS_TOKEN = "access-token-test-value";
const PROVIDER_CONFIG_FILE_NAME = "provider_config.json";
const AUTH_FILE_NAME = "auth.json";
const MODELS_CACHE_FILE_NAME = "models_cache.json";

interface CodexFixture {
  readonly root: string;
  readonly env: Record<string, string>;
  readonly configPath: string;
}

async function createCodexFixture(
  t: { after: (fn: () => Promise<void>) => void },
  options: {
    readonly auth?: unknown;
    readonly models?: unknown;
    readonly writeAuth?: boolean;
    readonly writeModels?: boolean;
  } = {},
): Promise<CodexFixture> {
  const root = await mkdtemp(join(tmpdir(), "zcode-codex-login-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const writeAuth = options.writeAuth ?? true;
  const writeModels = options.writeModels ?? true;
  if (writeAuth) {
    await writeJson(join(root, AUTH_FILE_NAME), options.auth ?? chatgptAuth());
  }
  if (writeModels) {
    await writeJson(join(root, MODELS_CACHE_FILE_NAME), options.models ?? defaultModelsCache());
  }
  const configPath = join(root, PROVIDER_CONFIG_FILE_NAME);
  return {
    root,
    configPath,
    env: {
      CODEX_HOME: root,
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: configPath,
    },
  };
}

/**
 * 登录写盘前会真连一次代理端口，用例不能写死 `127.0.0.1:1080`：那要求开发机
 * 恰好开着本地代理，CI 上必然 ECONNREFUSED。这里起一个只接受连接、不握手的
 * 临时监听，端口交给系统分配。
 */
async function startReachableProxy(t: {
  after: (fn: () => Promise<void>) => void;
}): Promise<number> {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object", "临时代理端口必须拿到");
  return address.port;
}

function chatgptAuth(): unknown {
  return {
    auth_mode: "chatgpt",
    tokens: {
      access_token: ACCESS_TOKEN,
      account_id: ACCOUNT_ID,
      refresh_token: "refresh-token-test-value",
    },
  };
}

function defaultModelsCache(): unknown {
  return {
    fetched_at: "2026-11-04T00:00:00Z",
    models: [
      modelEntry({
        slug: "gpt-6.1-sol",
        display_name: "GPT-6.1 Sol",
        priority: 1,
        context_window: 500000,
      }),
      modelEntry({
        slug: "gpt-6-luna",
        display_name: "GPT-6 Luna",
        priority: 5,
        context_window: 272000,
        supports_search_tool: true,
      }),
      // 非 API 模型与隐藏模型都不能进个人名单。
      modelEntry({ slug: "gpt-5.6-sol", display_name: "GPT-5.6 Sol", priority: 6, supported_in_api: false }),
      modelEntry({ slug: "codex-auto-review", display_name: "Auto Review", priority: 43, visibility: "hide" }),
    ],
  };
}

function modelEntry(input: {
  readonly slug: string;
  readonly display_name: string;
  readonly priority: number;
  readonly context_window?: number;
  readonly supported_in_api?: boolean;
  readonly visibility?: string;
  readonly supports_search_tool?: boolean;
}): unknown {
  return {
    slug: input.slug,
    display_name: input.display_name,
    priority: input.priority,
    visibility: input.visibility ?? "list",
    supported_in_api: input.supported_in_api ?? true,
    max_context_window: input.context_window ?? 272000,
    context_window: input.context_window ?? 272000,
    effective_context_window_percent: 95,
    input_modalities: ["text", "image"],
    supports_search_tool: input.supports_search_tool ?? false,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

/** 造一个只有 payload 有意义的 ID Token：真实凭据里这是签名 JWT，这里只需要 claim 能被解出来。 */
function idToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature-test`;
}

test("Codex 代理：裸 host:port 默认按 socks5h 远端解析", () => {
  assert.deepEqual(parseCodexProxyUrl("127.0.0.1:7890"), {
    type: "socks5h",
    host: "127.0.0.1",
    port: 7890,
  });
  assert.deepEqual(parseCodexProxyUrl("  socks5://user:p%40ss@proxy.local:1080  "), {
    type: "socks5",
    host: "proxy.local",
    port: 1080,
    username: "user",
    password: "p@ss",
  });
  assert.deepEqual(parseCodexProxyUrl("http://[::1]:8080"), {
    type: "http",
    host: "::1",
    port: 8080,
  });
});

test("Codex 代理：非法协议、缺端口、越界端口都要报错", () => {
  assert.throws(() => parseCodexProxyUrl(""), /代理地址为空/u);
  assert.throws(() => parseCodexProxyUrl("ftp://127.0.0.1:21"), /不支持的代理协议：ftp/u);
  assert.throws(() => parseCodexProxyUrl("127.0.0.1"), /代理端口无效/u);
  assert.throws(() => parseCodexProxyUrl("socks5h://:1080"), /代理地址缺少主机名/u);
  assert.throws(() => parseCodexProxyUrl("socks5h://127.0.0.1:70000"), /代理端口无效/u);
});

test("Codex 凭据：读出 ChatGPT 登录态，异常形态给出可操作提示", async (t) => {
  const fixture = await createCodexFixture(t);
  const credentials = await readCodexCredentials({ env: fixture.env });
  assert.equal(credentials.accessToken, ACCESS_TOKEN);
  assert.equal(credentials.accountId, ACCOUNT_ID);
  assert.equal(credentials.authFilePath, join(fixture.root, AUTH_FILE_NAME));

  await assert.rejects(
    readCodexCredentials({ env: { ...fixture.env, CODEX_HOME: join(fixture.root, "missing") } }),
    /找不到 Codex 凭据/u,
  );

  const apiKeyFixture = await createCodexFixture(t, {
    auth: { auth_mode: "api-key", OPENAI_API_KEY: "sk-test" },
  });
  await assert.rejects(readCodexCredentials({ env: apiKeyFixture.env }), /不是 ChatGPT 登录态/u);

  const noAccountFixture = await createCodexFixture(t, {
    auth: { auth_mode: "chatgpt", tokens: { access_token: ACCESS_TOKEN } },
  });
  await assert.rejects(
    readCodexCredentials({ env: noAccountFixture.env }),
    /缺少 tokens.account_id/u,
  );
});

test("Codex 凭据：带 UTF-8 BOM 的文件照样能读（Windows 工具写出的形态）", async (t) => {
  const fixture = await createCodexFixture(t);
  await writeFile(
    join(fixture.root, AUTH_FILE_NAME),
    `\uFEFF${JSON.stringify(chatgptAuth())}`,
    "utf8",
  );
  await writeFile(
    join(fixture.root, MODELS_CACHE_FILE_NAME),
    `\uFEFF${JSON.stringify(defaultModelsCache())}`,
    "utf8",
  );

  const credentials = await readCodexCredentials({ env: fixture.env });
  assert.equal(credentials.accessToken, ACCESS_TOKEN);
  const descriptors = await readCodexModelDescriptors({ env: fixture.env });
  assert.deepEqual(descriptors.map((descriptor) => descriptor.modelId), ["gpt-6.1-sol", "gpt-6-luna"]);
});

test("Codex 凭据：api-key 登录态给出可操作的提示，而不是报缺字段", async (t) => {
  const fixture = await createCodexFixture(t, {
    auth: { OPENAI_API_KEY: "sk-test", CODEX_API_KEY: "sk-test" },
  });
  await assert.rejects(readCodexCredentials({ env: fixture.env }), /API Key 登录态/u);
});

test("Codex 模型目录：过滤 hide/非 API 模型，按 priority 升序并折算上下文", async (t) => {
  const fixture = await createCodexFixture(t);
  const descriptors = await readCodexModelDescriptors({ env: fixture.env });
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.modelId),
    ["gpt-6.1-sol", "gpt-6-luna"],
  );
  assert.equal(descriptors[0]?.contextWindow, 475000);
  assert.equal(descriptors[0]?.origin, "cache");
  assert.equal(descriptors[1]?.supportsNativeWebSearch, true);
  assert.equal(descriptors[1]?.supportsImage, true);
});

test("Codex 模型目录：缺失回落到内置快照，空目录不回落到快照", async (t) => {
  const missing = await createCodexFixture(t, { writeModels: false });
  const fallback = await readCodexModelDescriptors({ env: missing.env });
  assert.equal(fallback.length, 8);
  assert.equal(fallback[0]?.origin, "fallback");
  assert.equal(fallback[0]?.contextWindow, undefined);

  const empty = await createCodexFixture(t, { models: { models: [] } });
  await assert.rejects(
    readCodexModelDescriptors({ env: empty.env }),
    /Codex 模型缓存没有可用模型/u,
  );
});

test("zcode login codex：一次写入 Provider 规则、模型属性与默认选择", async (t) => {
  const fixture = await createCodexFixture(t);
  const proxyPort = await startReachableProxy(t);
  const result = await loginCodexCli({
    env: fixture.env,
    proxyUrl: `socks5h://127.0.0.1:${proxyPort}`,
  });

  assert.equal(result.providerId, CODEX_PROVIDER_ID);
  assert.equal(result.modelId, "gpt-6.1-sol");
  assert.equal(result.mainModel, `${CODEX_PROVIDER_ID}/gpt-6.1-sol`);
  assert.equal(result.configPath, fixture.configPath);
  assert.deepEqual(result.modelIds, ["gpt-6.1-sol", "gpt-6-luna"]);
  assert.deepEqual(result.network, { type: "socks5h", host: "127.0.0.1", port: proxyPort });

  const file = await readJson(fixture.configPath);
  assert.equal(file.schemaVersion, 1);
  const rules = file.config.providerConfigRules.providerRules as any[];
  const codexRule = rules.find((rule) => rule.providerId === CODEX_PROVIDER_ID);
  assert.ok(codexRule, "个人 Provider 配置里应有 codex 规则");
  assert.equal(codexRule.providerName, "Codex");
  assert.deepEqual(codexRule.config.api, {
    type: "openai-responses",
    baseUrl: CODEX_API_BASE_URL,
    headers: { "chatgpt-account-id": ACCOUNT_ID, originator: "codex_cli_rs" },
  });
  assert.deepEqual(codexRule.config.access, { type: "api-key", apiKey: ACCESS_TOKEN });
  assert.deepEqual(codexRule.config.network, { type: "socks5h", host: "127.0.0.1", port: proxyPort });
  assert.deepEqual(codexRule.config.personalModelIds, ["gpt-6.1-sol", "gpt-6-luna"]);
  assert.deepEqual(codexRule.config.modelOrder, ["gpt-6.1-sol", "gpt-6-luna"]);
  assert.equal(codexRule.config.group, "standard-personal");
  assert.equal(codexRule.config.visibility, "visible");
  assert.deepEqual(file.config.defaultModelSelection, {
    providerId: CODEX_PROVIDER_ID,
    modelId: "gpt-6.1-sol",
  });

  const modelRules = file.config.modelConfigRules.providerModelRules as any[];
  assert.equal(modelRules.length, 2);
  const solRule = modelRules.find((rule) => rule.modelId === "gpt-6.1-sol");
  assert.equal(solRule.config.enabled, true);
  assert.equal(solRule.config.properties.contextWindow, 475000);
  assert.deepEqual(solRule.config.properties.inputFormat, {
    supportsText: true,
    supportsImage: true,
  });
  assert.equal(solRule.config.properties.supportsToolCall, true);
  assert.equal(solRule.config.properties.supportsJsonSchemaOutput, undefined);
});

test("zcode login codex：不给 --proxy 时清掉旧代理，回落到全局网络设置", async (t) => {
  const fixture = await createCodexFixture(t);
  const proxyPort = await startReachableProxy(t);
  const first = await loginCodexCli({
    env: fixture.env,
    proxyUrl: `socks5://user:pass@127.0.0.1:${proxyPort}`,
  });
  assert.deepEqual(first.network, {
    type: "socks5",
    host: "127.0.0.1",
    port: proxyPort,
    username: "user",
    password: "pass",
  });

  const second = await loginCodexCli({ env: fixture.env });
  assert.equal(second.network, undefined);
  const file = await readJson(fixture.configPath);
  const rules = file.config.providerConfigRules.providerRules as any[];
  const codexRule = rules.find((rule) => rule.providerId === CODEX_PROVIDER_ID);
  assert.equal(codexRule.config.network, undefined);
});

test("zcode login codex：--model 只接受缓存里可见的模型", async (t) => {
  const fixture = await createCodexFixture(t);
  const picked = await loginCodexCli({ env: fixture.env, modelId: "gpt-6-luna" });
  assert.equal(picked.modelId, "gpt-6-luna");
  assert.equal(picked.mainModel, `${CODEX_PROVIDER_ID}/gpt-6-luna`);

  await assert.rejects(
    loginCodexCli({ env: fixture.env, modelId: "gpt-5.6-sol" }),
    /不支持的 Codex 模型：gpt-5\.6-sol/u,
  );
});

test("Codex 模型目录：只有 max_context_window 的条目照样折算窗口", async (t) => {
  const fixture = await createCodexFixture(t, {
    models: {
      models: [
        {
          slug: "gpt-6.1-terra",
          display_name: "GPT-6.1 Terra",
          priority: 1,
          visibility: "list",
          supported_in_api: true,
          max_context_window: 400000,
          effective_context_window_percent: 95,
        },
      ],
    },
  });

  const descriptors = await readCodexModelDescriptors({ env: fixture.env });
  // 上游 `resolved_context_window()` 是 `context_window.or(max_context_window)`：
  // 上游缓存里确实有只给 max 的条目，此时窗口必须仍能算出来。
  assert.equal(descriptors[0]?.contextWindow, 380000);
});

test("Codex 凭据：ID Token 声明 FedRAMP 时改走 gov 域并写进连接", async (t) => {
  const commercial = await createCodexFixture(t);
  assert.equal(
    (await readCodexCredentials({ env: commercial.env })).apiBaseUrl,
    CODEX_API_BASE_URL,
  );

  const fedramp = await createCodexFixture(t, {
    auth: {
      auth_mode: "chatgpt",
      tokens: {
        access_token: ACCESS_TOKEN,
        account_id: ACCOUNT_ID,
        id_token: idToken({
          "https://api.openai.com/auth": {
            chatgpt_account_id: ACCOUNT_ID,
            chatgpt_account_is_fedramp: true,
          },
        }),
      },
    },
  });
  assert.equal(
    (await readCodexCredentials({ env: fedramp.env })).apiBaseUrl,
    CODEX_FEDRAMP_API_BASE_URL,
  );

  const result = await loginCodexCli({ env: fedramp.env });
  assert.equal(result.apiBaseUrl, CODEX_FEDRAMP_API_BASE_URL);
  const file = await readJson(fedramp.configPath);
  const rules = file.config.providerConfigRules.providerRules as any[];
  const codexRule = rules.find((rule) => rule.providerId === CODEX_PROVIDER_ID);
  assert.equal(codexRule.config.api.baseUrl, CODEX_FEDRAMP_API_BASE_URL);
});

test("Codex 凭据：id_token 缺失或解不开时按商业域，不阻断登录", async (t) => {
  const malformed = await createCodexFixture(t, {
    auth: {
      auth_mode: "chatgpt",
      tokens: { access_token: ACCESS_TOKEN, account_id: ACCOUNT_ID, id_token: "not-a-jwt" },
    },
  });
  const credentials = await readCodexCredentials({ env: malformed.env });
  assert.equal(credentials.apiBaseUrl, CODEX_API_BASE_URL);
  assert.equal((await loginCodexCli({ env: malformed.env })).apiBaseUrl, CODEX_API_BASE_URL);
});

test("Codex 凭据：非 chatgpt 登录态逐档说明是什么，并给出下一步", async (t) => {
  const cases: readonly { auth: unknown; expected: RegExp }[] = [
    {
      auth: { auth_mode: "personalAccessToken" },
      expected: /auth_mode=personalAccessToken，个人访问令牌凭据/u,
    },
    {
      auth: { auth_mode: "bedrockApiKey" },
      expected: /auth_mode=bedrockApiKey，Amazon Bedrock API Key 登录态/u,
    },
    {
      auth: { auth_mode: "bedrockAccessKeys" },
      expected: /auth_mode=bedrockAccessKeys，Amazon Bedrock Access Key 登录态/u,
    },
    { auth: { auth_mode: "headers" }, expected: /auth_mode=headers，自定义请求头登录态/u },
    { auth: { auth_mode: "agentIdentity" }, expected: /auth_mode=agentIdentity，Agent 身份凭据/u },
    {
      auth: { auth_mode: "chatgptAuthTokens" },
      expected: /auth_mode=chatgptAuthTokens，宿主应用注入的会话令牌/u,
    },
    { auth: { auth_mode: "apikey" }, expected: /auth_mode=apikey，API Key 登录态/u },
  ];

  for (const item of cases) {
    const fixture = await createCodexFixture(t, { auth: item.auth });
    await assert.rejects(readCodexCredentials({ env: fixture.env }), item.expected);
  }

  const fixture = await createCodexFixture(t, { auth: { auth_mode: "api-key" } });
  await assert.rejects(
    readCodexCredentials({ env: fixture.env }),
    /不是 ChatGPT 登录态/u,
    "旧的 api-key 写法也要命中同一档提示",
  );
  await assert.rejects(
    readCodexCredentials({ env: fixture.env }),
    /在 Codex 里用 ChatGPT 账号登录一次/u,
    "错误信息必须给出下一步，而不是只报不符",
  );
});
