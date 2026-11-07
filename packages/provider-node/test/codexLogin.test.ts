/**
 * Codex 登录链路的两个「静默失败点」回归测试。
 *
 * 起因（实测）：本机 ChatGPT 登录态的 `~/.codex/auth.json` 把用不到的键写成 `null`
 * （`{"OPENAI_API_KEY": null, "tokens": {..., "id_token": null}}`），而 schema 用
 * `z.string().optional()` ⇒ 报 `expected string, received null` ⇒ 整个登录失败，
 * 界面上却显示「请确认本机已登录 Codex，且代理地址可用」，把用户引向完全无关的方向。
 * 第二条：登录只写配置不发请求，代理端口填错（7897 写成 7896）过去会「登录成功」，
 * 直到第一次聊天才以连接错误暴露。这两点都必须钉住。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readCodexCredentials } from "../src/codex/codex-credentials.js";
import { parseCodexProxyUrl } from "../src/codex/codex-connection.js";
import { probeProxyReachability } from "../src/codex/proxy-probe.js";

interface TempCodexHome {
  readonly dir: string;
  readonly env: Readonly<Record<string, string>>;
  write(namespace: string, file: string, content: unknown): string;
  cleanup(): void;
}

function createTempCodexHome(): TempCodexHome {
  const dir = mkdtempSync(join(tmpdir(), "zcode-codex-"));
  return {
    dir,
    env: { CODEX_HOME: dir },
    write(namespace, file, content) {
      const target = namespace ? join(dir, namespace, file) : join(dir, file);
      writeFileSync(target, JSON.stringify(content), "utf8");
      return target;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("ChatGPT 登录态里用不到的键写成 null 时仍能读出凭据", async () => {
  const home = createTempCodexHome();
  try {
    home.write("", "auth.json", {
      OPENAI_API_KEY: null,
      auth_mode: "chatgpt",
      last_refresh: "2026-11-05T03:00:00Z",
      tokens: {
        access_token: "access-token-value",
        account_id: "account-id-value",
        id_token: null,
        refresh_token: null,
      },
    });
    const credentials = await readCodexCredentials({ env: home.env });
    assert.equal(credentials.accessToken, "access-token-value");
    assert.equal(credentials.accountId, "account-id-value");
    // 没有 id_token 就不能判 FedRAMP，必须落回商业域基址。
    assert.equal(credentials.apiBaseUrl, "https://chatgpt.com/backend-api/codex");
    assert.equal(credentials.authFilePath, join(home.dir, "auth.json"));
    // refresh_token 为 null 时不能投影出空串，否则调用方会拿空令牌去刷新。
    assert.equal(credentials.refreshToken, undefined);
  } finally {
    home.cleanup();
  }
});

test("api-key 登录态的 tokens 为 null 时仍报「API Key 登录态」而不是格式无法识别", async () => {
  const home = createTempCodexHome();
  try {
    home.write("", "auth.json", { OPENAI_API_KEY: "sk-test-value", tokens: null });
    await assert.rejects(() => readCodexCredentials({ env: home.env }), /API Key 登录态/u);
  } finally {
    home.cleanup();
  }
});

test("缺少 tokens.account_id 时给出可行动的错误", async () => {
  const home = createTempCodexHome();
  try {
    home.write("", "auth.json", {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: { access_token: "access-token-value", account_id: null },
    });
    await assert.rejects(() => readCodexCredentials({ env: home.env }), /缺少 tokens\.account_id/u);
  } finally {
    home.cleanup();
  }
});

test("只写 host:port 的代理地址按 socks5h（远端解析 DNS）处理", () => {
  assert.deepEqual(parseCodexProxyUrl("127.0.0.1:7896"), {
    type: "socks5h",
    host: "127.0.0.1",
    port: 7896,
  });
  assert.deepEqual(parseCodexProxyUrl("socks5://user:p%40ss@10.0.0.2:1080"), {
    type: "socks5",
    host: "10.0.0.2",
    port: 1080,
    username: "user",
    password: "p@ss",
  });
  assert.throws(() => parseCodexProxyUrl("127.0.0.1:0"), /代理端口无效/u);
  assert.throws(() => parseCodexProxyUrl("ftp://127.0.0.1:21"), /不支持的代理协议/u);
});

test("代理端口没人监听时探针失败，并且错误里带出地址与原因", async () => {
  // 先占一个端口再放掉，保证这个端口在本机确实空着（不写死 7896，避免撞上真实代理）。
  const server = createServer();
  const closedPort = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
  await assert.rejects(
    () =>
      probeProxyReachability({
        type: "socks5h",
        host: "127.0.0.1",
        port: closedPort,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /代理无法连接：socks5h:\/\/127\.0\.0\.1:\d+/u);
      assert.match(error.message, /拒绝连接|连接超时/u);
      return true;
    },
  );
});

test("代理端口有人监听时探针放行", async () => {
  const server = createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  try {
    await probeProxyReachability({ type: "socks5h", host: "127.0.0.1", port });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
