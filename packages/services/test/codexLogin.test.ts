import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ProviderSettingsFacade, ProviderSettingsView } from "@zcode/provider";
import {
  applyCodexConnection,
  CODEX_API_BASE_URL,
  CODEX_PROVIDER_ID,
  NodePersonalProviderConfigRepository,
  parseCodexProxyUrl,
} from "@zcode/provider-node";
import { createCodexLogin } from "../src/model-provider/codexLoginTarget.js";
import type { ProviderConfigRuntime } from "../src/model-provider/providerConfigRuntime.js";
import { createProviderSettingsService } from "../src/model-provider/providerFacadeServices.js";

/**
 * 「Codex 登录」在桌面端设置页的写入证据。
 *
 * 桌面端不另写一份接入逻辑：`loginCodex` 走 `createCodexLogin` → `applyCodexConnection`，
 * 与 `zcode login codex` 同一份实现、同一个 repository。这里钉四件事：
 * ① 落盘的 Provider 规则把这条连接固定在自己的代理上（含 socks5 凭据）；
 * ② 每条模型都有显式配置，且不写 schema 会拒绝的 `builtinModelIds`；
 * ③ 重登不传代理时旧代理被清掉，而不是静默沿用；
 * ④ 服务层未装配能力时明确失败，装配后先写配置再刷新视图。
 *
 * 运行：node --import tsx --test packages/services/test/codexLogin.test.ts（cwd 为包目录）。
 */

const ACCOUNT_ID = "account-test-0001";
const ACCESS_TOKEN = "access-token-test-value";
const PROVIDER_CONFIG_FILE_NAME = "provider_config.json";
const AUTH_FILE_NAME = "auth.json";
const MODELS_CACHE_FILE_NAME = "models_cache.json";
const CODEX_PREFERRED_MODEL_ID = "gpt-6.1-sol";
const CODEX_SECOND_MODEL_ID = "gpt-6-luna";
const CODEX_SOL_CONTEXT_WINDOW = 475_000;
const CODEX_LUNA_CONTEXT_WINDOW = 258_400;

interface CodexFixture {
  readonly root: string;
  readonly authFilePath: string;
  readonly cacheFilePath: string;
  readonly configPath: string;
  readonly repository: NodePersonalProviderConfigRepository;
}

async function createCodexFixture(t: {
  after: (fn: () => Promise<void>) => void;
}): Promise<CodexFixture> {
  const root = await mkdtemp(join(tmpdir(), "zcode-codex-desktop-"));
  const authFilePath = join(root, AUTH_FILE_NAME);
  const cacheFilePath = join(root, MODELS_CACHE_FILE_NAME);
  const configPath = join(root, PROVIDER_CONFIG_FILE_NAME);
  await writeJson(authFilePath, chatgptAuth());
  await writeJson(cacheFilePath, modelsCache());
  // 不轮询文件：测试只关心一次写入的结果，轮询会让 after 钩子与定时器竞争。
  const repository = new NodePersonalProviderConfigRepository({
    filePath: configPath,
    pollingIntervalMs: false,
  });
  t.after(async () => {
    repository.dispose();
    await rm(root, { recursive: true, force: true });
  });
  return { root, authFilePath, cacheFilePath, configPath, repository };
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

function modelsCache(): unknown {
  return {
    fetched_at: "2026-11-04T00:00:00Z",
    models: [
      modelEntry({ slug: CODEX_PREFERRED_MODEL_ID, priority: 1, contextWindow: 500_000 }),
      modelEntry({
        slug: CODEX_SECOND_MODEL_ID,
        priority: 5,
        contextWindow: 272_000,
        supportsSearchTool: true,
      }),
      // 非 API 与隐藏模型都不能进个人成员名单。
      modelEntry({ slug: "gpt-5.6-sol", priority: 6, supportedInApi: false }),
      modelEntry({ slug: "codex-auto-review", priority: 43, visibility: "hide" }),
    ],
  };
}

function modelEntry(input: {
  readonly slug: string;
  readonly priority: number;
  readonly contextWindow?: number;
  readonly supportedInApi?: boolean;
  readonly visibility?: string;
  readonly supportsSearchTool?: boolean;
}): unknown {
  const contextWindow = input.contextWindow ?? 272_000;
  return {
    slug: input.slug,
    display_name: input.slug,
    priority: input.priority,
    visibility: input.visibility ?? "list",
    supported_in_api: input.supportedInApi ?? true,
    max_context_window: contextWindow,
    context_window: contextWindow,
    effective_context_window_percent: 95,
    input_modalities: ["text", "image"],
    supports_search_tool: input.supportsSearchTool ?? false,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * 登录写盘前会真连一次代理端口（`probeProxyReachability`），所以用例不能写死
 * `127.0.0.1:1080`：那要求开发机恰好开着本地代理，CI 上必然 ECONNREFUSED。
 * 这里起一个只接受连接、不握手的临时监听，端口由系统分配。
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

function readCodexRule(repository: NodePersonalProviderConfigRepository) {
  return repository.read().then((snapshot) => {
    const rule = snapshot.providers.getRule(CODEX_PROVIDER_ID);
    assert.ok(rule, "写入后必须存在 codex Provider 规则");
    return { snapshot, rule };
  });
}

test("Codex 登录写入的连接把模型请求固定在该代理上", async (t) => {
  const fixture = await createCodexFixture(t);
  const proxyPort = await startReachableProxy(t);
  const result = await applyCodexConnection({
    repository: fixture.repository,
    env: {},
    authFilePath: fixture.authFilePath,
    cacheFilePath: fixture.cacheFilePath,
    proxyUrl: `socks5h://codex:s3cret@127.0.0.1:${proxyPort}`,
  });

  assert.equal(result.providerId, CODEX_PROVIDER_ID);
  assert.equal(result.mainModel, `${CODEX_PROVIDER_ID}/${CODEX_PREFERRED_MODEL_ID}`);
  assert.deepEqual(result.modelIds, [CODEX_PREFERRED_MODEL_ID, CODEX_SECOND_MODEL_ID]);
  assert.equal(result.modelOrigin, "cache");
  assert.equal(result.apiBaseUrl, CODEX_API_BASE_URL);
  assert.deepEqual(result.network, {
    type: "socks5h",
    host: "127.0.0.1",
    port: proxyPort,
    username: "codex",
    password: "s3cret",
  });

  const { snapshot, rule } = await readCodexRule(fixture.repository);
  assert.equal(rule.providerName, "Codex");
  assert.equal(rule.config.group, "standard-personal");
  assert.equal(rule.config.access.type, "api-key");
  assert.equal(rule.config.access.apiKey, ACCESS_TOKEN);
  assert.equal(rule.config.api.type, "openai-responses");
  assert.equal(rule.config.api.baseUrl, CODEX_API_BASE_URL);
  assert.deepEqual(rule.config.api.headers, {
    "chatgpt-account-id": ACCOUNT_ID,
    originator: "codex_cli_rs",
  });
  // 代理写在连接自己身上：模型请求由它出网，而不是回落到全局 httpProxy。
  assert.deepEqual(rule.config.network, result.network);
  assert.deepEqual(rule.config.personalModelIds, [CODEX_PREFERRED_MODEL_ID, CODEX_SECOND_MODEL_ID]);
  assert.deepEqual(snapshot.defaultModelSelection, {
    providerId: CODEX_PROVIDER_ID,
    modelId: CODEX_PREFERRED_MODEL_ID,
  });

  const preferred = snapshot.models.getExact(CODEX_PROVIDER_ID, CODEX_PREFERRED_MODEL_ID);
  assert.ok(preferred, "首选模型必须有显式配置");
  assert.equal(preferred.enabled, true);
  assert.equal(preferred.properties.contextWindow, CODEX_SOL_CONTEXT_WINDOW);
  assert.equal(preferred.properties.inputFormat?.supportsImage, true);
  const second = snapshot.models.getExact(CODEX_PROVIDER_ID, CODEX_SECOND_MODEL_ID);
  assert.ok(second, "第二条模型也必须有显式配置");
  assert.equal(second.properties.contextWindow, CODEX_LUNA_CONTEXT_WINDOW);
  assert.equal(second.properties.supportsNativeWebSearch, true);
  // 目录里非 API / 隐藏的模型不能被悄悄写成个人模型。
  assert.equal(snapshot.models.getExact(CODEX_PROVIDER_ID, "codex-auto-review"), undefined);

  // 个人 Provider 规则写 builtinModelIds 会被 schema 拒绝，落盘文件里不能出现它。
  const raw = await readFile(fixture.configPath, "utf8");
  assert.doesNotMatch(raw, /builtinModelIds/u);
});

test("重登不传代理时清掉旧代理", async (t) => {
  const fixture = await createCodexFixture(t);
  const proxyPort = await startReachableProxy(t);
  const base = {
    repository: fixture.repository,
    env: {},
    authFilePath: fixture.authFilePath,
    cacheFilePath: fixture.cacheFilePath,
  };
  await applyCodexConnection({ ...base, proxyUrl: `127.0.0.1:${proxyPort}` });
  const withProxy = await readCodexRule(fixture.repository);
  assert.deepEqual(withProxy.rule.config.network, {
    type: "socks5h",
    host: "127.0.0.1",
    port: proxyPort,
  });

  const relogin = await applyCodexConnection(base);
  assert.equal(relogin.network, undefined);
  const cleared = await readCodexRule(fixture.repository);
  assert.equal(cleared.rule.config.network, undefined);
});

test("代理地址解析覆盖 sk5 常见写法", () => {
  assert.deepEqual(parseCodexProxyUrl("127.0.0.1:7890"), {
    type: "socks5h",
    host: "127.0.0.1",
    port: 7890,
  });
  assert.deepEqual(parseCodexProxyUrl("socks5://user:p%40ss@10.0.0.2:1080"), {
    type: "socks5",
    host: "10.0.0.2",
    port: 1080,
    username: "user",
    password: "p@ss",
  });
  assert.deepEqual(parseCodexProxyUrl("http://[::1]:8080"), {
    type: "http",
    host: "::1",
    port: 8080,
  });
  assert.throws(() => parseCodexProxyUrl("ftp://127.0.0.1:21"), /不支持的代理协议/u);
  assert.throws(() => parseCodexProxyUrl("socks5://127.0.0.1:0"), /代理端口无效/u);
  assert.throws(() => parseCodexProxyUrl("   "), /代理地址为空/u);
});

test("桌面端 loginCodex：写配置后刷新设置视图", async (t) => {
  const fixture = await createCodexFixture(t);
  const proxyPort = await startReachableProxy(t);
  const previousCodexHome = process.env.CODEX_HOME;
  // createCodexLogin 把 process.env 交给共享实现，模型缓存按 CODEX_HOME 解析。
  process.env.CODEX_HOME = fixture.root;
  t.after(() => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  });

  const view = { providers: [] } as unknown as ProviderSettingsView;
  const refreshReasons: string[] = [];
  const facade = {
    onDidChange: () => () => {},
    getView: () => view,
    refresh: async (reason: string) => {
      refreshReasons.push(reason);
      return view;
    },
  } as unknown as ProviderSettingsFacade;
  // loginCodex 只用到 personalRepository；Registry 刷新由 facade 承担，测试里用替身。
  const configRuntime = {
    personalRepository: fixture.repository,
  } as unknown as ProviderConfigRuntime;
  const service = createProviderSettingsService(
    facade,
    undefined,
    undefined,
    undefined,
    createCodexLogin(configRuntime),
  );

  const result = await service.loginCodex({
    authFilePath: fixture.authFilePath,
    modelId: CODEX_SECOND_MODEL_ID,
    proxyUrl: `socks5://127.0.0.1:${proxyPort}`,
  });

  assert.equal(result.providerId, CODEX_PROVIDER_ID);
  assert.equal(result.modelId, CODEX_SECOND_MODEL_ID);
  assert.equal(result.view, view);
  assert.deepEqual(refreshReasons, ["codex-login"]);
  const { snapshot, rule } = await readCodexRule(fixture.repository);
  assert.deepEqual(rule.config.network, { type: "socks5", host: "127.0.0.1", port: proxyPort });
  assert.deepEqual(snapshot.defaultModelSelection, {
    providerId: CODEX_PROVIDER_ID,
    modelId: CODEX_SECOND_MODEL_ID,
  });
});

test("未装配 Codex 登录能力时明确失败", async () => {
  const view = { providers: [] } as unknown as ProviderSettingsView;
  const facade = {
    onDidChange: () => () => {},
    getView: () => view,
    refresh: async () => view,
  } as unknown as ProviderSettingsFacade;
  const service = createProviderSettingsService(facade);
  await assert.rejects(() => service.loginCodex({}), /当前 Environment 未装配 Codex 登录能力/u);
});
