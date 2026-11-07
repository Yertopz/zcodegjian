// ============================================================
// Agent Profile Writer
// ============================================================

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CREATE_AGENT_NAME_PATTERN,
  CoreErrorType,
  RESERVED_AGENT_NAMES,
  createCoreError,
  isCoreError,
} from "@zcode/contracts";
import type { CoreError } from "@zcode/contracts";
import type { AgentProfile } from "./profile.js";

/** 结构化错误码：调用方按码分支，不解析错误文本。 */
export const AGENT_PROFILE_ERROR_CODE = {
  alreadyExists: "agent_already_exists",
  invalidDefinition: "agent_invalid_definition",
} as const;

/** 同名 agent 已存在（内存名单或磁盘文件其一命中）。 */
export function isAgentAlreadyExistsError(error: unknown): error is CoreError {
  return isCoreError(error) && error.context?.code === AGENT_PROFILE_ERROR_CODE.alreadyExists;
}

/** 名字非法或与内置 agent 重名。 */
export function isInvalidAgentDefinitionError(error: unknown): error is CoreError {
  return isCoreError(error) && error.context?.code === AGENT_PROFILE_ERROR_CODE.invalidDefinition;
}

/** `CreateAgent` 可写进 Markdown 的最小 profile 形状。 */
export interface WritableAgentProfileInput {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: readonly string[];
  /** 群聊头像颜色；与 AgentProfile.color 取值一致，缺省时不写 frontmatter。 */
  color?: AgentProfile["color"];
  /** 权限模式；与 AgentProfile.permissionMode 取值一致，缺省时不写 frontmatter。 */
  permissionMode?: AgentProfile["permissionMode"];
}

export const AGENT_PROFILE_FILE_EXTENSION = ".md";

/**
 * 把 profile 序列化成带 frontmatter 的 Markdown。
 *
 * 序列化结果必须能被 `parseAgentProfileFromMarkdown` 原样读回：
 * - 解析器只做「剥掉最外层引号」，不做反斜杠反转义，因此值里不能塞 `\"`；
 * - `description` 的换行由解析器按字面 `\n` 还原，所以这里也写成字面 `\n`。
 * 两种引号都出现的描述无法无损引用，统一把双引号降级成单引号（只影响显示，不影响语义）。
 */
export function serializeAgentProfileMarkdown(profile: WritableAgentProfileInput): string {
  const lines = [
    "---",
    `name: ${formatFrontmatterScalar(profile.name)}`,
    `description: ${formatFrontmatterScalar(profile.description)}`,
  ];
  if (profile.tools && profile.tools.length > 0) {
    lines.push(`tools: [${profile.tools.map((tool) => formatFrontmatterScalar(tool)).join(", ")}]`);
  }
  // 解析器（profile.ts normalizeColor / normalizePermissionMode）按原样读回这两个键；
  // 缺省时不输出，保持与旧文件完全一致的形状。
  if (profile.color) {
    lines.push(`color: ${formatFrontmatterScalar(profile.color)}`);
  }
  if (profile.permissionMode) {
    lines.push(`permissionMode: ${formatFrontmatterScalar(profile.permissionMode)}`);
  }
  // CreateAgent 产出的都是多智能体团队成员：固定写 kind: team，设置页据此把它
  // 与普通子智能体分组展示；无 kind 的既有文件继续按普通子智能体处理。
  lines.push("kind: team");
  lines.push("---", "", profile.systemPrompt.trim(), "");
  return lines.join("\n");
}

function formatFrontmatterScalar(value: string): string {
  const flat = value.replace(/\r?\n/gu, "\\n").trim();
  if (flat.length === 0) return '""';
  if (!/[:#'"]/u.test(flat)) return flat;
  if (!flat.includes('"')) return `"${flat}"`;
  if (!flat.includes("'")) return `'${flat}'`;
  return `"${flat.replace(/"/gu, "'")}"`;
}

/** 名字同时决定文件名与 `@` 提及目标，因此先校验再落盘。 */
export function assertWritableAgentName(name: string): string {
  const trimmed = name.trim();
  if (!CREATE_AGENT_NAME_PATTERN.test(trimmed)) {
    throw invalidAgentDefinition(
      `Agent name must match ${String(CREATE_AGENT_NAME_PATTERN)}: ${JSON.stringify(name)}`,
    );
  }
  if (RESERVED_AGENT_NAMES.some((reserved) => reserved.toLowerCase() === trimmed.toLowerCase())) {
    throw invalidAgentDefinition(`Agent name is reserved by a built-in agent: ${trimmed}`);
  }
  return trimmed;
}

function invalidAgentDefinition(message: string): Error {
  return createCoreError(CoreErrorType.ToolExecutionFailed, message, {
    context: { code: AGENT_PROFILE_ERROR_CODE.invalidDefinition },
    recoverable: true,
  });
}

export interface WriteUserAgentProfileResult {
  /** 落盘绝对路径。 */
  path: string;
}

/**
 * 在用户级 agent 目录新建 `<name>.md`。
 *
 * 用 `wx` 打开：同名文件已存在时由内核直接拒绝（EEXIST），不覆盖用户已有定义。
 * 落盘先于内存变更：写失败时 runtime profile 列表保持不变。
 */
export async function writeUserAgentProfile(input: {
  agentsDir: string;
  profile: WritableAgentProfileInput;
}): Promise<WriteUserAgentProfileResult> {
  const name = assertWritableAgentName(input.profile.name);
  const path = join(input.agentsDir, `${name}${AGENT_PROFILE_FILE_EXTENSION}`);
  await mkdir(input.agentsDir, { recursive: true });
  const content = serializeAgentProfileMarkdown({ ...input.profile, name });
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (isFileExistsError(error)) {
      throw createCoreError(
        CoreErrorType.ToolExecutionFailed,
        `Agent already exists: ${name} (${path}). Pick another name or edit that file.`,
        {
          context: {
            code: AGENT_PROFILE_ERROR_CODE.alreadyExists,
            agentName: name,
            path,
          },
          recoverable: true,
        },
      );
    }
    throw error;
  }
  return { path };
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

/** 新建成功后同步进当前会话的 profile 列表，模型可以不重开会话直接 `@` 它。 */
export function createAgentProfileFromInput(input: {
  agentsDir: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools?: readonly string[];
  color?: AgentProfile["color"];
  permissionMode?: AgentProfile["permissionMode"];
}): AgentProfile {
  const name = assertWritableAgentName(input.name);
  const path = join(input.agentsDir, `${name}${AGENT_PROFILE_FILE_EXTENSION}`);
  return {
    name,
    description: input.description.trim(),
    source: "user",
    systemPrompt: input.systemPrompt.trim(),
    path,
    ...(input.tools && input.tools.length > 0 ? { tools: [...input.tools] } : {}),
    ...(input.color ? { color: input.color } : {}),
    ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
    kind: "team",
  };
}
