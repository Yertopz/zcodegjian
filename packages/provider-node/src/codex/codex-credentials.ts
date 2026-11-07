/**
 * Codex 本机凭据与模型目录读取。
 *
 * Codex 自己维护登录态（`~/.codex/auth.json`）和模型目录（`~/.codex/models_cache.json`），
 * 这里只读、不写，也不改 `config.toml`。所有失败都带上具体路径抛给调用方，
 * 由 CLI 入口统一格式化；缺文件与格式错误是两种不同的用户可行动错误，不能合并成兜底值。
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const CODEX_PROVIDER_ID = "codex";
export const CODEX_PROVIDER_NAME = "Codex";
/** ChatGPT 后端的 Codex Responses endpoint；请求路径是 `${baseUrl}/responses`。 */
export const CODEX_API_BASE_URL = "https://chatgpt.com/backend-api/codex";
/** Codex CLI 自称，后端据此区分客户端类型。 */
export const CODEX_ORIGINATOR = "codex_cli_rs";
export const CODEX_ACCOUNT_ID_HEADER = "chatgpt-account-id";
export const CODEX_ORIGINATOR_HEADER = "originator";
export const CODEX_CHATGPT_AUTH_MODE = "chatgpt";
/**
 * FedRAMP 工作区只能走 gov 边缘域；与上游 `FEDRAMP_CODEX_BASE_URL` 同值
 * （openai/codex `codex-rs/model-provider/src/models_endpoint.rs`）。
 */
export const CODEX_FEDRAMP_API_BASE_URL = "https://gov.chatgpt.com/backend-api/codex";
/** ID Token 里 ChatGPT 专属 claim 的命名空间；上游 `IdClaims.auth` 的 serde rename 同值。 */
const CODEX_ID_TOKEN_AUTH_CLAIM = "https://api.openai.com/auth";
/** 该 claim 为 true 表示账号必须走 FedRAMP 边缘域，上游 `IdTokenInfo::is_fedramp_account`。 */
const CODEX_ID_TOKEN_FEDRAMP_CLAIM = "chatgpt_account_is_fedramp";
/** Codex 自己的 home 目录变量；不是 ZCode 的配置项。 */
export const CODEX_HOME_ENV = "CODEX_HOME";
export const CODEX_AUTH_FILE_NAME = "auth.json";
export const CODEX_MODELS_CACHE_FILE_NAME = "models_cache.json";
export const CODEX_MODEL_VISIBILITY_LIST = "list";
export const CODEX_IMAGE_MODALITY = "image";
export const CODEX_PERCENT_SCALE = 100;
/** UTF-8 BOM 的字符码；Windows 工具写出的 JSON 常带它。 */
const UTF8_BOM_CHAR_CODE = 0xfeff;

/**
 * 实测快照（scripts 之外无法离线获取 Codex 目录时使用）。
 * 顺序与 `models_cache.json` 的 priority 升序一致，只含 `supported_in_api` 且 `visibility === "list"` 的模型。
 */
export const FALLBACK_CODEX_MODEL_IDS = [
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gpt-6.1-terra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;
export const DEFAULT_CODEX_MODEL_ID: string = FALLBACK_CODEX_MODEL_IDS[0];

/**
 * 字段一律 `.nullish()` 而不是 `.optional()`：
 * Codex CLI 写盘时把「本登录态用不到的键」显式写成 `null` 而不是省略，
 * 实测 ChatGPT 登录态的 auth.json 就是 `{"OPENAI_API_KEY": null, ...}`，
 * 用 `.optional()` 会报 `expected string, received null` 并让整次登录失败。
 */
const codexAuthFileSchema = z.looseObject({
  auth_mode: z.string().nullish(),
  // `codex login --api-key` 写出的 auth.json 只有这两个键：没有 auth_mode，也没有 tokens。
  OPENAI_API_KEY: z.string().nullish(),
  CODEX_API_KEY: z.string().nullish(),
  tokens: z
    .looseObject({
      access_token: z.string().nullish(),
      account_id: z.string().nullish(),
      refresh_token: z.string().nullish(),
      // 只在判定 FedRAMP 边缘域时用到；不解码就无法知道该走 gov 域。
      id_token: z.string().nullish(),
    })
    .nullish(),
});
type CodexAuthFile = z.infer<typeof codexAuthFileSchema>;

const codexModelCacheEntrySchema = z.looseObject({
  slug: z.string().optional(),
  display_name: z.string().optional(),
  context_window: z.number().int().positive().optional(),
  // 上游部分条目只给 `max_context_window`，`context_window` 为 null；
  // `ModelInfo::resolved_context_window()` 会退回到它（openai/codex `protocol/src/openai_models.rs`）。
  max_context_window: z.number().int().positive().optional(),
  effective_context_window_percent: z.number().positive().optional(),
  input_modalities: z.array(z.string()).optional(),
  supports_search_tool: z.boolean().optional(),
  supported_in_api: z.boolean().optional(),
  visibility: z.string().optional(),
  priority: z.number().optional(),
});
type CodexModelCacheEntry = z.infer<typeof codexModelCacheEntrySchema>;

const codexModelsCacheFileSchema = z.looseObject({
  models: z.array(codexModelCacheEntrySchema).optional(),
});

export interface CodexCredentials {
  readonly accessToken: string;
  readonly accountId: string;
  readonly refreshToken?: string;
  readonly authFilePath: string;
  /** 该账号该走的后端基址：商业域或 FedRAMP gov 域。 */
  readonly apiBaseUrl: string;
}

export type CodexModelOrigin = "cache" | "fallback";

export interface CodexModelDescriptor {
  readonly modelId: string;
  readonly displayName: string;
  readonly priority: number;
  readonly contextWindow?: number;
  readonly supportsImage: boolean;
  readonly supportsNativeWebSearch: boolean;
  readonly origin: CodexModelOrigin;
}

export type CodexEnvRecord = Readonly<Record<string, string | undefined>>;

export interface CodexPathInput {
  readonly env: CodexEnvRecord;
}

export interface ReadCodexCredentialsInput extends CodexPathInput {
  readonly authFilePath?: string;
}

export interface ReadCodexModelDescriptorsInput extends CodexPathInput {
  readonly cacheFilePath?: string;
}

export function resolveCodexHome(env: CodexEnvRecord): string {
  const explicit = env[CODEX_HOME_ENV]?.trim();
  return explicit && explicit.length > 0 ? explicit : join(homedir(), ".codex");
}

export function resolveCodexAuthFilePath(input: ReadCodexCredentialsInput): string {
  const explicit = input.authFilePath?.trim();
  return explicit && explicit.length > 0
    ? explicit
    : join(resolveCodexHome(input.env), CODEX_AUTH_FILE_NAME);
}

export function resolveCodexModelsCacheFilePath(input: ReadCodexModelDescriptorsInput): string {
  const explicit = input.cacheFilePath?.trim();
  return explicit && explicit.length > 0
    ? explicit
    : join(resolveCodexHome(input.env), CODEX_MODELS_CACHE_FILE_NAME);
}

/** Codex 请求必须带的两个头；字段名单点定义，避免调用点各写一份。 */
export function buildCodexRequestHeaders(
  credentials: Pick<CodexCredentials, "accountId">,
): Readonly<Record<string, string>> {
  return {
    [CODEX_ACCOUNT_ID_HEADER]: credentials.accountId,
    [CODEX_ORIGINATOR_HEADER]: CODEX_ORIGINATOR,
  };
}

export async function readCodexCredentials(
  input: ReadCodexCredentialsInput,
): Promise<CodexCredentials> {
  const authFilePath = resolveCodexAuthFilePath(input);
  const raw = await readJsonFile(authFilePath);
  if (raw === null) {
    throw new Error(
      `找不到 Codex 凭据：${authFilePath}（先用 Codex 登录一次，或用 --auth-file 指定）`,
    );
  }
  const parsed = codexAuthFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Codex 凭据格式无法识别：${authFilePath}（${describeIssues(parsed.error)}）`);
  }
  const data: CodexAuthFile = parsed.data;
  const authMode = data.auth_mode?.trim();
  if (authMode && authMode !== CODEX_CHATGPT_AUTH_MODE) {
    throw new Error(
      `Codex 凭据不是 ChatGPT 登录态（${describeCodexAuthMode(authMode)}）：${authFilePath}（在 Codex 里用 ChatGPT 账号登录一次，或用 --auth-file 指定 ChatGPT 凭据）`,
    );
  }
  const accessToken = data.tokens?.access_token?.trim();
  if (!accessToken) {
    // api-key 登录态（auth_mode 缺省 + OPENAI_API_KEY/CODEX_API_KEY）也要走这里，
    // 只报「缺少 tokens.access_token」会让用户去查一个其实完好的文件。
    if (data.OPENAI_API_KEY?.trim() || data.CODEX_API_KEY?.trim()) {
      throw new Error(
        `Codex 凭据是 API Key 登录态，本命令只认 ChatGPT 登录态：${authFilePath}（在 Codex 里用 ChatGPT 账号登录一次，或用 --auth-file 指定 ChatGPT 凭据）`,
      );
    }
    throw new Error(`Codex 凭据缺少 tokens.access_token：${authFilePath}`);
  }
  const accountId = data.tokens?.account_id?.trim();
  if (!accountId) throw new Error(`Codex 凭据缺少 tokens.account_id：${authFilePath}`);
  const refreshToken = data.tokens?.refresh_token?.trim();
  return {
    accessToken,
    accountId,
    authFilePath,
    apiBaseUrl: resolveCodexApiBaseUrl(data.tokens?.id_token?.trim()),
    ...(refreshToken ? { refreshToken } : {}),
  };
}

/**
 * 上游 `AuthMode` 共 8 种（`app-server-protocol/src/protocol/common.rs`），
 * 本命令只接 `chatgpt`。逐档给出这是什么，避免用户拿「缺少 tokens.access_token」
 * 去查一个其实完好的文件。`apikey` 同时容忍 `api-key` 这种手写形态。
 */
const CODEX_AUTH_MODE_LABELS: Readonly<Record<string, string>> = {
  apikey: "API Key 登录态",
  "api-key": "API Key 登录态",
  chatgptauthtokens: "宿主应用注入的会话令牌（不落盘，无法从文件导入）",
  headers: "自定义请求头登录态",
  agentidentity: "Agent 身份凭据",
  personalaccesstoken: "个人访问令牌凭据",
  bedrockapikey: "Amazon Bedrock API Key 登录态",
  bedrockaccesskeys: "Amazon Bedrock Access Key 登录态",
};

function describeCodexAuthMode(authMode: string): string {
  const label = CODEX_AUTH_MODE_LABELS[authMode.toLowerCase()];
  return `auth_mode=${authMode}，${label ?? "不是本命令支持的登录态"}`;
}

/**
 * 依据 ID Token 的 `chatgpt_account_is_fedramp` 选后端基址。
 *
 * 上游在商业域与 FedRAMP gov 域之间切换用的是同一个 claim
 * （`login/src/token_data.rs` 的 `IdTokenInfo::is_fedramp_account`）。没有 id_token、
 * claim 缺失或 JWT 解不开时按商业域处理 —— 与上游默认一致；登录结果里会带上
 * 最终基址，用户能在输出里看到选了哪一个，不做无痕兜底。
 */
export function resolveCodexApiBaseUrl(idToken: string | undefined): string {
  const auth = asJsonObject(asJsonObject(readJwtPayload(idToken))?.[CODEX_ID_TOKEN_AUTH_CLAIM]);
  return auth?.[CODEX_ID_TOKEN_FEDRAMP_CLAIM] === true
    ? CODEX_FEDRAMP_API_BASE_URL
    : CODEX_API_BASE_URL;
}

function readJwtPayload(jwt: string | undefined): unknown {
  const payload = jwt?.split(".")[1];
  if (!payload) return undefined;
  try {
    // JWT 的 payload 段是 base64url（无 padding），Buffer 直接支持该编码。
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function asJsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * 读 Codex 的模型目录。缓存缺失时退回实测快照（`origin: "fallback"`）；
 * 缓存存在但没有任何 `supported_in_api` + `visibility === "list"` 的模型时报错，
 * 因为这通常意味着缓存被裁剪或是另一个客户端的缓存，静默用快照会掩盖真正的问题。
 */
export async function readCodexModelDescriptors(
  input: ReadCodexModelDescriptorsInput,
): Promise<readonly CodexModelDescriptor[]> {
  const cacheFilePath = resolveCodexModelsCacheFilePath(input);
  const raw = await readJsonFile(cacheFilePath);
  if (raw === null) return fallbackCodexModelDescriptors();

  const parsed = codexModelsCacheFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Codex 模型缓存格式无法识别：${cacheFilePath}（${describeIssues(parsed.error)}）`,
    );
  }
  const descriptors = (parsed.data.models ?? [])
    .filter(isApiVisibleCodexModel)
    .map(toCodexModelDescriptor)
    .filter((descriptor): descriptor is CodexModelDescriptor => descriptor !== null);
  if (descriptors.length === 0) {
    throw new Error(`Codex 模型缓存没有可用模型：${cacheFilePath}（先用 Codex 拉取模型目录）`);
  }
  return [...descriptors].sort((left, right) => left.priority - right.priority);
}

/** `--model` 的取值校验：只接受当前目录里的模型，避免写出一条永远请求不到的默认选择。 */
export function resolveCodexModelId(
  descriptors: readonly CodexModelDescriptor[],
  requestedModelId: string | undefined,
): string {
  const requested = requestedModelId?.trim();
  if (!requested) return descriptors[0]?.modelId ?? DEFAULT_CODEX_MODEL_ID;
  if (descriptors.some((descriptor) => descriptor.modelId === requested)) return requested;
  throw new Error(
    `不支持的 Codex 模型：${requested}（可选：${descriptors.map((descriptor) => descriptor.modelId).join(", ")}）`,
  );
}

function fallbackCodexModelDescriptors(): readonly CodexModelDescriptor[] {
  return FALLBACK_CODEX_MODEL_IDS.map((modelId, index) => ({
    modelId,
    displayName: modelId,
    priority: index,
    supportsImage: true,
    supportsNativeWebSearch: false,
    origin: "fallback",
  }));
}

function isApiVisibleCodexModel(entry: CodexModelCacheEntry): boolean {
  return entry.supported_in_api === true && entry.visibility === CODEX_MODEL_VISIBILITY_LIST;
}

function toCodexModelDescriptor(entry: CodexModelCacheEntry): CodexModelDescriptor | null {
  const modelId = entry.slug?.trim();
  if (!modelId) return null;
  const contextWindow = resolveContextWindow(entry);
  return {
    modelId,
    displayName: entry.display_name?.trim() || modelId,
    priority: entry.priority ?? Number.MAX_SAFE_INTEGER,
    supportsImage: entry.input_modalities?.includes(CODEX_IMAGE_MODALITY) === true,
    supportsNativeWebSearch: entry.supports_search_tool === true,
    origin: "cache",
    ...(contextWindow === undefined ? {} : { contextWindow }),
  };
}

/** Codex 后端按 `effective_context_window_percent` 折扣真实可用窗口，这里按同一规则折算。 */
function resolveContextWindow(entry: CodexModelCacheEntry): number | undefined {
  // 上游 `resolved_context_window()` 是 `context_window.or(max_context_window)`：
  // 只给 `max_context_window` 的条目也要能算出窗口，否则模型面板上窗口是空的。
  const declared = entry.context_window ?? entry.max_context_window;
  if (declared === undefined) return undefined;
  const percent = entry.effective_context_window_percent;
  if (percent === undefined) return declared;
  const effective = Math.floor((declared * percent) / CODEX_PERCENT_SCALE);
  return effective > 0 ? effective : declared;
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw new Error(`无法读取 ${filePath}`, { cause: error });
  }
  try {
    // Windows 上用 PowerShell / 记事本改过的 JSON 常常带 UTF-8 BOM，JSON.parse 见到 BOM 直接抛错；
    // 实测本机 `~/.codex/auth.json` 就是这种形态，读入前统一剥掉。
    const normalized = text.charCodeAt(0) === UTF8_BOM_CHAR_CODE ? text.slice(1) : text;
    return JSON.parse(normalized) as unknown;
  } catch (error) {
    throw new Error(`${filePath} 不是合法 JSON`, { cause: error });
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
  );
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
    .join("; ");
}
