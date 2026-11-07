import { formatJson } from "@zcode/core";
import type { GlobalOptions, RunContext } from "@zcode/shared-types";
import { loadBootstrapModule } from "./bootstrap-loader.js";
import { loadCliDotenv, type CliEnv } from "./env.js";
import type { RunDependencies } from "./cli-types.js";

/** `zcode login codex` 专用的三个开关；其他 Provider 传了就是用法错误。 */
export interface LoginCommandFlags {
  readonly proxyUrl?: string;
  readonly authFilePath?: string;
  readonly modelId?: string;
}

const CODING_PLAN_LOGIN_PROVIDERS = new Set<"zai" | "bigmodel">(["zai", "bigmodel"]);
const CODEX_LOGIN_PROVIDER = "codex";
const DEFAULT_LOGIN_PROVIDER = "zai";
/** `modelOrigin` 的 fallback 取值，含义是没读到 `models_cache.json`、用了内置快照。 */
const CODEX_FALLBACK_MODEL_ORIGIN = "fallback";
const CODEX_FALLBACK_NOTE =
  "built-in snapshot (no models_cache.json in CODEX_HOME; open Codex once, then rerun to pick up the live list)";
const LOGIN_USAGE = [
  "Usage: zcode login [zai|bigmodel] [--no-browser]",
  "       zcode login codex [--proxy <url>] [--auth-file <path>] [--model <id>]",
].join("\n");

export async function runLoginCommand(
  ctx: RunContext,
  options: GlobalOptions,
  deps: RunDependencies,
  noBrowser: boolean,
  args: readonly string[] = [],
  flags: LoginCommandFlags = {},
): Promise<number> {
  try {
    const providerId = args[0] ?? DEFAULT_LOGIN_PROVIDER;
    const isCodex = providerId === CODEX_LOGIN_PROVIDER;
    if (args.length > 1 || (!isCodex && !CODING_PLAN_LOGIN_PROVIDERS.has(providerId as "zai"))) {
      throw new Error(LOGIN_USAGE);
    }
    const env = deps.env ?? process.env;
    loadDotenvOrThrow(deps, env);

    if (isCodex) {
      return await runCodexLogin(ctx, options, deps, env, flags);
    }
    if (flags.proxyUrl !== undefined || flags.authFilePath !== undefined || flags.modelId !== undefined) {
      throw new Error(`--proxy / --auth-file / --model 只适用于 codex 登录。\n${LOGIN_USAGE}`);
    }

    const login = deps.loginZCodeCli ?? (await loadBootstrapModule()).loginZCodeCli;
    const result = await login({
      env,
      noBrowser,
      providerId: providerId as "zai" | "bigmodel",
      onAuthorizeUrl: (data) => {
        writeAuthorizeUrl(ctx, options, data.authorize_url, noBrowser, providerId as "zai" | "bigmodel");
      },
      onBrowserOpen: (browser) => {
        if (!options.json && !browser.opened) {
          ctx.stdout.write(`Browser open failed: ${browser.reason ?? "unknown error"}\n`);
        }
      },
    });

    if (options.json) {
      ctx.stdout.write(
        formatJson({
          status: "ready",
          provider: result.providerId,
          user: {
            user_id: result.user.user_id,
            ...(result.user.email ? { email: result.user.email } : {}),
            ...(result.user.name ? { name: result.user.name } : {}),
            ...(result.user.avatar ? { avatar: result.user.avatar } : {}),
          },
          model: result.model,
          credentialsPath: result.credentialsPath,
          configPath: result.configPath,
          browserOpened: result.browser?.opened ?? false,
        }),
      );
      return 0;
    }

    ctx.stdout.write(
      [
        `Login successful${formatUserLabel(result.user)}.`,
        `Model: ${result.model}`,
        `Credentials: ${result.credentialsPath}`,
        `Model selection: ${result.configPath}`,
      ].join("\n") + "\n",
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`Error: ${message}\n`);
    if (options.verbose && error instanceof Error && error.stack) {
      ctx.stderr.write(`${error.stack}\n`);
    }
    return 1;
  }
}

/**
 * 直接复用 Codex 自己的 ChatGPT 登录态，只把「怎么连」写进 ZCode 的个人 Provider 配置。
 * 这里不做浏览器登录：凭据来源是 `$CODEX_HOME/auth.json`（或用 `--auth-file` 指定）。
 */
async function runCodexLogin(
  ctx: RunContext,
  options: GlobalOptions,
  deps: RunDependencies,
  env: CliEnv,
  flags: LoginCommandFlags,
): Promise<number> {
  const loginCodex = deps.loginCodexCli ?? (await loadBootstrapModule()).loginCodexCli;
  const result = await loginCodex({
    env,
    ...(flags.proxyUrl ? { proxyUrl: flags.proxyUrl } : {}),
    ...(flags.authFilePath ? { authFilePath: flags.authFilePath } : {}),
    ...(flags.modelId ? { modelId: flags.modelId } : {}),
  });

  const egress = result.network
    ? `${result.network.type}://${result.network.host}:${result.network.port}`
    : "global network settings";
  // 代理密码是凭据，输出里只保留 scheme/host/port 与「是否带凭据」。
  const egressProxy = result.network
    ? {
        type: result.network.type,
        host: result.network.host,
        port: result.network.port,
        authenticated: Boolean(result.network.username),
      }
    : null;

  if (options.json) {
    ctx.stdout.write(
      formatJson({
        status: "ready",
        provider: result.providerId,
        model: result.mainModel,
        modelOrigin: result.modelOrigin,
        models: [...result.modelIds],
        endpoint: result.apiBaseUrl,
        egressProxy,
        credentialsPath: result.authFilePath,
        configPath: result.configPath,
      }),
    );
    return 0;
  }

  const modelSourceNote =
    result.modelOrigin === CODEX_FALLBACK_MODEL_ORIGIN ? `Model source: ${CODEX_FALLBACK_NOTE}` : undefined;

  ctx.stdout.write(
    [
      `Login successful (${result.providerName}).`,
      `Model: ${result.mainModel}`,
      // 商业域与 FedRAMP gov 域只在凭据的 ID Token 里有区别，输出里点名走的是哪一个。
      `Endpoint: ${result.apiBaseUrl}`,
      ...(modelSourceNote ? [modelSourceNote] : []),
      `Egress proxy: ${egress}`,
      `Credentials: ${result.authFilePath}`,
      `Provider config: ${result.configPath}`,
    ].join("\n") + "\n",
  );
  return 0;
}

/** .env 读失败要在入口统一转成可操作提示，不能带着半个环境继续登录。 */
function loadDotenvOrThrow(deps: RunDependencies, env: CliEnv): void {
  const dotenvResult = (deps.loadDotenv ?? loadCliDotenv)({
    cwd: (deps.cwd ?? process.cwd)(),
    env,
  });
  if (dotenvResult.error) {
    throw new Error(`Failed to load environment file: ${dotenvResult.path}`, {
      cause: dotenvResult.error,
    });
  }
}

export async function runLogoutCommand(
  ctx: RunContext,
  options: GlobalOptions,
  deps: RunDependencies,
): Promise<number> {
  try {
    const env = deps.env ?? process.env;
    loadDotenvOrThrow(deps, env);

    const logout = deps.logoutZCodeCli ?? (await loadBootstrapModule()).logoutZCodeCli;
    const result = await logout({ env });

    if (options.json) {
      ctx.stdout.write(
        formatJson({
          status: "logged_out",
          provider: "zai",
          credentialsPath: result.credentialsPath,
        }),
      );
      return 0;
    }

    ctx.stdout.write(
      `Logged out from Coding Plan accounts. Credentials: ${result.credentialsPath}\n`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`Error: ${message}\n`);
    if (options.verbose && error instanceof Error && error.stack) {
      ctx.stderr.write(`${error.stack}\n`);
    }
    return 1;
  }
}

function writeAuthorizeUrl(
  ctx: RunContext,
  options: GlobalOptions,
  authorizeUrl: string,
  noBrowser: boolean,
  providerId: "zai" | "bigmodel",
): void {
  const target = options.json ? ctx.stderr : ctx.stdout;
  if (noBrowser) {
    target.write(`Open this URL to sign in:\n${authorizeUrl}\n`);
    return;
  }

  target.write(
    `Opening browser for ${providerId === "bigmodel" ? "BigModel" : "Z.AI"} authorization.\nFallback URL:\n${authorizeUrl}\n`,
  );
}

function formatUserLabel(user: { email?: string; name?: string; user_id: string }): string {
  const label = user.name || user.email || user.user_id;
  return label ? ` as ${label}` : "";
}
