/**
 * `zcode login codex` 的 CLI 适配层。
 *
 * 真正写配置的逻辑在 `@zcode/provider-node` 的 `applyCodexConnection`，与桌面端
 * 「添加供应商 → Codex 登录」共用同一份实现。这里只负责 CLI 独有的事：
 * 解析个人 Provider 配置路径、注入带 legacy 导入的 repository、把路径带回给命令行输出。
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { EnvRecord } from "@zcode/adapters/model";
import {
  applyCodexConnection,
  NodePersonalProviderConfigRepository,
  PERSONAL_PROVIDER_CONFIG_FILE_NAME,
  ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV,
  type CodexConnectionResult,
  type CodexProxyConfig,
  type CodexProxyType,
} from "@zcode/provider-node";
import { readLegacyCliPersonalProviderConfig } from "./app/legacy-cli-personal-provider-config-importer.js";

export { parseCodexProxyUrl } from "@zcode/provider-node";
export type { CodexProxyConfig, CodexProxyType } from "@zcode/provider-node";

const CODE_DATA_BASE_DIR_ENV = "ZCODE_DATA_BASE_DIR";
const CODE_HOME_DIR_NAME = ".zcode";
const CODE_CONFIG_VERSION_DIR_NAME = "v2";

export interface LoginCodexCliOptions {
  readonly env: EnvRecord;
  readonly authFilePath?: string;
  readonly cacheFilePath?: string;
  /** SOCKS5 / HTTP 代理 URL；不传则这条连接沿用全局网络设置。 */
  readonly proxyUrl?: string;
  readonly modelId?: string;
  readonly personalProviderConfigPath?: string;
  readonly providerName?: string;
}

export interface LoginCodexCliResult extends CodexConnectionResult {
  readonly configPath: string;
}

export async function loginCodexCli(options: LoginCodexCliOptions): Promise<LoginCodexCliResult> {
  const configPath = resolvePersonalProviderConfigPath(options);

  // 登录与运行时共享同一个文件和事务：一次 update 写完，避免中途失败留下半条连接。
  const personalRepository = new NodePersonalProviderConfigRepository({
    filePath: configPath,
    importLegacy: () => readLegacyCliPersonalProviderConfig({}),
    pollingIntervalMs: false,
  });
  try {
    const result = await applyCodexConnection({
      repository: personalRepository,
      env: options.env,
      ...(options.authFilePath === undefined ? {} : { authFilePath: options.authFilePath }),
      ...(options.cacheFilePath === undefined ? {} : { cacheFilePath: options.cacheFilePath }),
      ...(options.proxyUrl === undefined ? {} : { proxyUrl: options.proxyUrl }),
      ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
      ...(options.providerName === undefined ? {} : { providerName: options.providerName }),
    });
    return { ...result, configPath };
  } finally {
    personalRepository.dispose();
  }
}

function resolvePersonalProviderConfigPath(options: LoginCodexCliOptions): string {
  const explicit = options.personalProviderConfigPath?.trim();
  if (explicit) return explicit;
  const fromEnv = options.env[ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  if (fromEnv) return fromEnv;
  const dataBaseDir = options.env[CODE_DATA_BASE_DIR_ENV]?.trim() || homedir();
  return join(
    dataBaseDir,
    CODE_HOME_DIR_NAME,
    CODE_CONFIG_VERSION_DIR_NAME,
    PERSONAL_PROVIDER_CONFIG_FILE_NAME,
  );
}
