import assert from "node:assert/strict";
import test from "node:test";
import type { GlobalOptions, RunContext } from "@zcode/shared-types";
import type { LoginCodexCliOptions, LoginCodexCliResult } from "../../bootstrap/src/index.js";
import type { RunDependencies } from "../src/cli-types.js";
import { runLoginCommand } from "../src/login-command.js";

/**
 * `zcode login codex` 的命令层契约。
 *
 * 钉住三件事：
 * ① `--proxy` / `--auth-file` / `--model` 只服务 codex；给 zai/bigmodel 传了必须报用法错误，
 *   不能静默忽略 —— 忽略等于用户以为自己在走代理，实际直连。
 * ② 三个开关原样交给 bootstrap，命令层不解析代理地址（解析在 codex-login.ts，那里有单测）。
 * ③ 输出里不能出现代理密码：JSON 只给 scheme/host/port 与「是否带凭据」。
 *
 * 运行：cd apps/zcode-cli/packages/cli && node --import tsx --test test/codexLoginCommand.test.ts
 */

const PROXY_URL = "socks5h://user:secret@127.0.0.1:1080";
const MODEL_ID = "gpt-6-luna";

const codexResult: LoginCodexCliResult = {
  providerId: "codex",
  providerName: "Codex",
  modelId: MODEL_ID,
  mainModel: `codex/${MODEL_ID}`,
  modelIds: ["gpt-6.1-sol", MODEL_ID],
  modelOrigin: "cache",
  configPath: "/tmp/zcode/provider_config.json",
  authFilePath: "/tmp/codex/auth.json",
  apiBaseUrl: "https://chatgpt.com/backend-api/codex",
  network: {
    type: "socks5h",
    host: "127.0.0.1",
    port: 1080,
    username: "user",
    password: "secret",
  },
};

type Harness = {
  ctx: RunContext;
  options: GlobalOptions;
  deps: RunDependencies;
  stdout: () => string;
  stderr: () => string;
  calls: LoginCodexCliOptions[];
};

function createHarness(overrides: Partial<LoginCodexCliResult> = {}): Harness {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const calls: LoginCodexCliOptions[] = [];
  const result: LoginCodexCliResult = { ...codexResult, ...overrides };
  const ctx = {
    stdout: { write: (chunk: string) => stdoutChunks.push(chunk) },
    stderr: { write: (chunk: string) => stderrChunks.push(chunk) },
  } as unknown as RunContext;
  const deps = {
    // 登录只读 env 与 cwd；.env 用空结果替身，避免测试机上的 .env 影响断言。
    env: {},
    cwd: () => process.cwd(),
    loadDotenv: () => ({ keys: [], loaded: false }),
    loginCodexCli: async (options: LoginCodexCliOptions) => {
      calls.push(options);
      return result;
    },
  } as unknown as RunDependencies;
  return {
    ctx,
    options: {} as GlobalOptions,
    deps,
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
    calls,
  };
}

test("codex 登录：三个开关原样交给 bootstrap，输出不含代理密码", async () => {
  const harness = createHarness();
  const code = await runLoginCommand(
    harness.ctx,
    harness.options,
    harness.deps,
    false,
    ["codex"],
    { proxyUrl: PROXY_URL, authFilePath: "/tmp/codex/auth.json", modelId: MODEL_ID },
  );

  assert.equal(code, 0);
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(
    {
      proxyUrl: harness.calls[0]?.proxyUrl,
      authFilePath: harness.calls[0]?.authFilePath,
      modelId: harness.calls[0]?.modelId,
    },
    { proxyUrl: PROXY_URL, authFilePath: "/tmp/codex/auth.json", modelId: MODEL_ID },
  );

  const output = harness.stdout();
  assert.match(output, /Model: codex\/gpt-6-luna/u);
  assert.match(output, /Egress proxy: socks5h:\/\/127\.0\.0\.1:1080/u);
  // 商业域与 FedRAMP gov 域只在 ID Token 里区分，输出必须点名实际写进连接的基址。
  assert.match(output, /Endpoint: https:\/\/chatgpt\.com\/backend-api\/codex/u);
  assert.match(output, /Credentials: \/tmp\/codex\/auth\.json/u);
  assert.doesNotMatch(output, /secret/u, "代理密码不能出现在 CLI 输出里");
});

test("codex 登录：JSON 输出给结构化的出口代理，且不带密码字段", async () => {
  const harness = createHarness();
  harness.options.json = true;
  const code = await runLoginCommand(harness.ctx, harness.options, harness.deps, false, ["codex"], {
    proxyUrl: PROXY_URL,
  });

  assert.equal(code, 0);
  const payload = JSON.parse(harness.stdout()) as {
    status: string;
    provider: string;
    model: string;
    modelOrigin: string;
    models: string[];
    endpoint: string;
    egressProxy: Record<string, unknown> | null;
  };
  assert.equal(payload.status, "ready");
  assert.equal(payload.provider, "codex");
  assert.equal(payload.model, "codex/gpt-6-luna");
  assert.equal(payload.modelOrigin, "cache");
  assert.equal(payload.endpoint, "https://chatgpt.com/backend-api/codex");
  assert.deepEqual(payload.models, ["gpt-6.1-sol", MODEL_ID]);
  assert.deepEqual(payload.egressProxy, {
    type: "socks5h",
    host: "127.0.0.1",
    port: 1080,
    authenticated: true,
  });
  assert.doesNotMatch(harness.stdout(), /secret/u);
});

test("codex 登录：不给开关时不伪造字段，交给 bootstrap 回落到全局网络设置", async () => {
  const harness = createHarness();
  const code = await runLoginCommand(harness.ctx, harness.options, harness.deps, false, ["codex"]);

  assert.equal(code, 0);
  assert.deepEqual(harness.calls[0], { env: {} });
});

test("codex 的开关不能落到 coding plan 登录上：报用法错误而不是静默忽略", async () => {
  const harness = createHarness();
  const code = await runLoginCommand(harness.ctx, harness.options, harness.deps, false, ["zai"], {
    proxyUrl: PROXY_URL,
  });

  assert.equal(code, 1);
  assert.match(harness.stderr(), /--proxy \/ --auth-file \/ --model 只适用于 codex 登录/u);
  assert.match(harness.stderr(), /zcode login codex/u);
});

test("未知 provider 与多余位置参数都给出完整用法", async () => {
  const unknown = createHarness();
  assert.equal(
    await runLoginCommand(unknown.ctx, unknown.options, unknown.deps, false, ["anthropic"]),
    1,
  );
  assert.match(unknown.stderr(), /Usage: zcode login \[zai\|bigmodel\]/u);

  const extra = createHarness();
  assert.equal(await runLoginCommand(extra.ctx, extra.options, extra.deps, false, ["codex", "x"]), 1);
  assert.match(extra.stderr(), /Usage: zcode login/u);
});

test("codex 登录：模型来自内置快照时点名来源，读到缓存时不加噪声", async () => {
  // 只在回退到内置快照时提示：此时模型清单可能比 Codex 实际可用的少，
  // 用户需要知道「重跑一次就能拿到完整列表」，而不是以为模型就这么多。
  const fallback = createHarness({ modelOrigin: "fallback" });
  assert.equal(await runLoginCommand(fallback.ctx, fallback.options, fallback.deps, false, ["codex"]), 0);
  assert.match(fallback.stdout(), /Model source: built-in snapshot/u);
  assert.match(fallback.stdout(), /models_cache\.json/u);

  const cached = createHarness();
  assert.equal(await runLoginCommand(cached.ctx, cached.options, cached.deps, false, ["codex"]), 0);
  assert.doesNotMatch(cached.stdout(), /Model source/u);
});
