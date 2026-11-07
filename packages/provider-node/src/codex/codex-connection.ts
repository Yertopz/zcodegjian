/**
 * Codex 连接写入：把 Codex 的 ChatGPT 登录态接成 ZCode 的一个 Provider。
 *
 * 一次调用只做一件事 —— 在个人 Provider 配置里原子写入一条自洽的 Codex 连接：
 * Provider 规则（endpoint / 请求头 / 出口代理 / 成员名单）、每条模型的属性、默认模型选择。
 * 不新增 OAuth 流程，不复制 refresh token，也不改 Codex 自己的 config.toml。
 *
 * 这里是唯一实现：CLI（`zcode login codex`）与桌面端「添加供应商 → Codex 登录」
 * 都调用 {@link applyCodexConnection}，区别只在于调用方注入的 repository 与输出格式。
 */
import {
  ApiKeyAccessConfig,
  ModelConfig,
  ModelInputFormatConfig,
  ModelPropertiesConfig,
  ProviderApiConfig,
  ProviderConfig,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@zcode/provider";
import {
  buildCodexRequestHeaders,
  CODEX_PROVIDER_ID,
  CODEX_PROVIDER_NAME,
  readCodexCredentials,
  readCodexModelDescriptors,
  resolveCodexModelId,
  type CodexEnvRecord,
  type CodexModelDescriptor,
  type CodexModelOrigin,
} from "./codex-credentials.js";
import { probeProxyReachability } from "./proxy-probe.js";

export const CODEX_PROVIDER_GROUP = "standard-personal";
const CODEX_PROVIDER_VISIBILITY = "visible";
export const CODEX_API_TYPE = "openai-responses";
const CODEX_ACCESS_TYPE = "api-key";
export const DEFAULT_CODEX_PROXY_TYPE = "socks5h";
const PROXY_SCHEME_SEPARATOR = "://";
const PROXY_USERINFO_SEPARATOR = "@";
const PROXY_CREDENTIAL_SEPARATOR = ":";
const PROXY_PORT_SEPARATOR = ":";
const IPV6_OPEN = "[";
const IPV6_CLOSE = "]";
const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
export const SUPPORTED_PROXY_TYPES = ["socks5", "socks5h", "http", "https"] as const;

export type CodexProxyType = (typeof SUPPORTED_PROXY_TYPES)[number];

export interface CodexProxyConfig {
  readonly type: CodexProxyType;
  readonly host: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
}

/**
 * 写入 Codex 连接所需的最小 repository 契约。
 *
 * 只声明 `update`：登录是一次事务写入，不需要读快照、不参与文件轮询。
 * 调用方注入 `NodePersonalProviderConfigRepository`（CLI 自建实例，桌面端用运行时唯一实例），
 * 这里不再自己构造 repository —— 否则会出现第二条写入路径。
 */
export interface CodexProviderConfigWriter {
  update(
    transform: (current: ProviderConfigLayerSnapshot) => ProviderConfigLayerUpdate,
  ): Promise<ProviderConfigLayerSnapshot>;
}

export interface ApplyCodexConnectionOptions {
  readonly repository: CodexProviderConfigWriter;
  readonly env: CodexEnvRecord;
  readonly authFilePath?: string;
  readonly cacheFilePath?: string;
  /** SOCKS5 / HTTP 代理 URL；不传则这条连接沿用全局网络设置。 */
  readonly proxyUrl?: string;
  readonly modelId?: string;
  readonly providerName?: string;
}

export interface CodexConnectionResult {
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly mainModel: string;
  readonly modelIds: readonly string[];
  readonly modelOrigin: CodexModelOrigin;
  readonly authFilePath: string;
  /** 写进连接的后端基址（商业域或 FedRAMP gov 域），用于让用户确认走了哪一个。 */
  readonly apiBaseUrl: string;
  readonly network?: CodexProxyConfig;
}

/**
 * 解析代理地址。只写 `host:port` 时按 SOCKS5（远端解析 DNS）处理，
 * 这是 "sk5 代理" 最常用的形态；显式 scheme 必须落在受支持集合内。
 */
export function parseCodexProxyUrl(rawValue: string): CodexProxyConfig {
  const trimmed = rawValue.trim();
  if (!trimmed) throw new Error("代理地址为空（示例：socks5h://user:pass@127.0.0.1:1080）");

  const schemeIndex = trimmed.indexOf(PROXY_SCHEME_SEPARATOR);
  const rawType = schemeIndex < 0 ? DEFAULT_CODEX_PROXY_TYPE : trimmed.slice(0, schemeIndex);
  const remainder =
    schemeIndex < 0 ? trimmed : trimmed.slice(schemeIndex + PROXY_SCHEME_SEPARATOR.length);
  const type = rawType.trim().toLowerCase();
  if (!isSupportedProxyType(type)) {
    throw new Error(`不支持的代理协议：${rawType}（可用：${SUPPORTED_PROXY_TYPES.join(" / ")}）`);
  }

  const atIndex = remainder.lastIndexOf(PROXY_USERINFO_SEPARATOR);
  const credentials = atIndex < 0 ? "" : remainder.slice(0, atIndex);
  const hostPort = atIndex < 0 ? remainder : remainder.slice(atIndex + 1);
  const colonIndex = credentials.indexOf(PROXY_CREDENTIAL_SEPARATOR);
  const username = decodeProxyPart(colonIndex < 0 ? credentials : credentials.slice(0, colonIndex));
  const password = decodeProxyPart(colonIndex < 0 ? "" : credentials.slice(colonIndex + 1));

  const { host, port } = splitProxyHostPort(hostPort, rawValue);
  return {
    type,
    host,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

/**
 * 读取 Codex 登录态与模型目录，写入（或刷新）个人 Provider 配置里的 Codex 连接。
 *
 * 失败一律抛给调用方：凭据缺失、格式不对、模型缓存为空都是用户可行动错误，
 * 不做静默降级（例如回退成一条没有 Key 的 Provider 规则）。
 */
export async function applyCodexConnection(
  options: ApplyCodexConnectionOptions,
): Promise<CodexConnectionResult> {
  const credentials = await readCodexCredentials({
    env: options.env,
    ...(options.authFilePath === undefined ? {} : { authFilePath: options.authFilePath }),
  });
  const descriptors = await readCodexModelDescriptors({
    env: options.env,
    ...(options.cacheFilePath === undefined ? {} : { cacheFilePath: options.cacheFilePath }),
  });
  const modelId = resolveCodexModelId(descriptors, options.modelId);
  const network =
    options.proxyUrl === undefined || options.proxyUrl.trim() === ""
      ? undefined
      : parseCodexProxyUrl(options.proxyUrl);
  // 写盘前先探一次端口：登录不发请求，代理不可达时过去会「成功」并拖到首次聊天才报错。
  if (network) await probeProxyReachability(network);
  const providerName = options.providerName?.trim() || CODEX_PROVIDER_NAME;
  const modelIds = descriptors.map((descriptor) => descriptor.modelId);

  // 登录与运行时共享同一份配置与事务：一次 update 写完，避免中途失败留下半条连接。
  await options.repository.update((current) =>
    buildCodexProviderUpdate({
      current,
      accessToken: credentials.accessToken,
      accountId: credentials.accountId,
      apiBaseUrl: credentials.apiBaseUrl,
      descriptors,
      modelIds,
      modelId,
      providerName,
      network,
    }),
  );

  return {
    providerId: CODEX_PROVIDER_ID,
    providerName,
    modelId,
    mainModel: `${CODEX_PROVIDER_ID}/${modelId}`,
    modelIds,
    modelOrigin: descriptors[0]?.origin ?? "fallback",
    authFilePath: credentials.authFilePath,
    apiBaseUrl: credentials.apiBaseUrl,
    ...(network ? { network } : {}),
  };
}

interface BuildCodexProviderUpdateInput {
  readonly current: ProviderConfigLayerSnapshot;
  readonly accessToken: string;
  readonly accountId: string;
  readonly apiBaseUrl: string;
  readonly descriptors: readonly CodexModelDescriptor[];
  readonly modelIds: readonly string[];
  readonly modelId: string;
  readonly providerName: string;
  readonly network?: CodexProxyConfig;
}

function buildCodexProviderUpdate(input: BuildCodexProviderUpdateInput): ProviderConfigLayerUpdate {
  const existingRule = input.current.providers.getRule(CODEX_PROVIDER_ID);
  const existingConfig = existingRule?.config;
  const config = new ProviderConfig({
    group: CODEX_PROVIDER_GROUP,
    // 保留已有的 logo 与隐藏集：重新登录只刷新连接事实，不改用户的展示偏好。
    logo: existingConfig?.logo,
    access: new ApiKeyAccessConfig({
      type: CODEX_ACCESS_TYPE,
      apiKey: input.accessToken,
    }),
    api: new ProviderApiConfig({
      type: CODEX_API_TYPE,
      baseUrl: input.apiBaseUrl,
      headers: buildCodexRequestHeaders({ accountId: input.accountId }),
    }),
    // 不填代理时显式清掉旧代理：这条连接应当回落到全局网络设置，而不是悄悄沿用历史值。
    network: input.network,
    // 成员名单只由 Personal 声明；builtinModelIds 属于 Built-in 配置，写在个人规则里会被 schema 拒绝。
    personalModelIds: input.modelIds,
    modelOrder: input.modelIds,
    hiddenModelIds: existingConfig?.hiddenModelIds ?? [],
    visibility: CODEX_PROVIDER_VISIBILITY,
  });
  let models = input.current.models.deleteExactForProvider(CODEX_PROVIDER_ID);
  for (const descriptor of input.descriptors) {
    models = models.setExact(
      CODEX_PROVIDER_ID,
      descriptor.modelId,
      buildCodexModelConfig(descriptor),
      true,
    );
  }
  return {
    providers: input.current.providers.setRule({
      ...existingRule,
      providerId: CODEX_PROVIDER_ID,
      providerName: input.providerName,
      config,
    }),
    models,
    defaultModelSelection: { providerId: CODEX_PROVIDER_ID, modelId: input.modelId },
  };
}

/** 只写 Codex 目录里有证据的字段，不臆造 JSON Schema 输出、会话中途 system 等能力。 */
function buildCodexModelConfig(descriptor: CodexModelDescriptor): ModelConfig {
  return new ModelConfig({
    enabled: true,
    properties: new ModelPropertiesConfig({
      ...(descriptor.contextWindow === undefined
        ? {}
        : { contextWindow: descriptor.contextWindow }),
      inputFormat: new ModelInputFormatConfig({
        supportsText: true,
        supportsImage: descriptor.supportsImage,
      }),
      supportsToolCall: true,
      ...(descriptor.supportsNativeWebSearch ? { supportsNativeWebSearch: true } : {}),
    }),
  });
}

function isSupportedProxyType(value: string): value is CodexProxyType {
  return (SUPPORTED_PROXY_TYPES as readonly string[]).includes(value);
}

function splitProxyHostPort(
  hostPort: string,
  rawValue: string,
): { readonly host: string; readonly port: number } {
  const target = hostPort.trim();
  if (!target) throw new Error(`代理地址缺少主机名：${rawValue}`);

  let host: string;
  let rawPort: string;
  if (target.startsWith(IPV6_OPEN)) {
    const closingIndex = target.indexOf(IPV6_CLOSE);
    if (closingIndex < 0) throw new Error(`IPv6 代理地址缺少 "]"：${rawValue}`);
    host = target.slice(1, closingIndex);
    const afterHost = target.slice(closingIndex + 1);
    rawPort = afterHost.startsWith(PROXY_PORT_SEPARATOR) ? afterHost.slice(1) : "";
  } else {
    const portIndex = target.lastIndexOf(PROXY_PORT_SEPARATOR);
    host = portIndex < 0 ? target : target.slice(0, portIndex);
    rawPort = portIndex < 0 ? "" : target.slice(portIndex + 1);
  }

  const normalizedHost = host.trim();
  if (!normalizedHost) throw new Error(`代理地址缺少主机名：${rawValue}`);
  const port = Number(rawPort.trim());
  if (!Number.isInteger(port) || port < MIN_TCP_PORT || port > MAX_TCP_PORT) {
    throw new Error(`代理端口无效：${rawPort || "<空>"}（应为 ${MIN_TCP_PORT}-${MAX_TCP_PORT}）`);
  }
  return { host: normalizedHost, port };
}

function decodeProxyPart(value: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    // 用户手写 `p@ss` 这类未转义密码时保留原值，交给连接层按原样发送。
    return value;
  }
}
