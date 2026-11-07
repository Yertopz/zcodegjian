import {
  CREATE_AGENT_TOOL_NAME,
  CreateAgentInputJsonSchema,
  CreateAgentInputSchema,
  CreateAgentOutputSchema,
  RESERVED_AGENT_NAMES,
  type CreateAgentInput,
  type CreateAgentOutput,
} from "@zcode/contracts";
import type { AgentProfile } from "../../subagent/profile.js";
import {
  createAgentProfileFromInput,
  isAgentAlreadyExistsError,
  isInvalidAgentDefinitionError,
  writeUserAgentProfile,
} from "../../subagent/profile-writer.js";
import type { ToolEntry, ToolHandler } from "../types.js";

const MAX_CREATE_AGENT_MODEL_BYTES = 2048;

/** 创建者身份与目录都在装配期确定；handler 不再猜运行期配置。 */
export interface CreateAgentTarget {
  /** 用户级 agent 目录（`<storageRoot>/agents`）。 */
  agentsDir: string;
  /** 当前会话已启用的 agent 名，用来在写盘前给出「已存在」的明确提示。 */
  enabledAgentNames: () => readonly string[];
  /** 落盘成功后把新 profile 并入本会话的 profile 列表，模型可立即 `@` 它。 */
  onCreated: (profile: AgentProfile) => void;
}

const CREATE_AGENT_PROVIDER_DESCRIPTION = [
  "# CreateAgent",
  "",
  "Create a new team member as a user-level agent (`<storageRoot>/agents/<name>.md`).",
  "The new agent is available to @-mention in this session immediately after creation; it is not spawned here.",
  "",
  "```json",
  '{"name": "docs-writer", "description": "Writes and reviews user documentation.", "systemPrompt": "You are ...", "tools": ["Read", "Grep"], "permissionMode": "plan", "color": "blue"}',
  "```",
  "",
  "Write teammates with intent, not one-liners:",
  "- systemPrompt must state the role, scope, explicit boundaries (what it must NOT do), collaboration interface (when to @ which teammate), and the expected output format.",
  "- description is a one-sentence tagline shown next to the agent name in the group-chat view.",
  "- tools: choose a minimal allowlist for the job; read-only teammates must not get write/execute tools.",
  "- permissionMode: read-only teammates use plan, write-capable ones auto; omit to inherit the session default.",  "- color: pick a distinct color per teammate so the group-chat view tells members apart.",
  "",
  "Rules: names must be unique and must not shadow a built-in agent; an existing file is never overwritten. This tool cannot create a child agent run — use SendMessage to @ the member.",
].join("\n");

const CREATE_AGENT_TOOL_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    status: { type: "string", enum: ["created", "exists", "invalid"] },
    name: { type: "string" },
    path: { type: "string" },
    message: { type: "string" },
  },
  required: ["status", "name", "message"],
  additionalProperties: false,
};

export function createCreateAgentToolEntry(options: { target: CreateAgentTarget }): ToolEntry {
  const handler: ToolHandler = async (input) => executeCreateAgent(input, options.target);
  return {
    capability: "Create a new user-level agent that teammates can @-mention",
    metadata: {
      // 与 SendMessage 同因：CreateAgent 是建队的入口动作，被 defer 后模型会直接跳过建成员。
      alwaysLoad: true,
      searchHint: "create a new agent teammate",
      name: CREATE_AGENT_TOOL_NAME,
      description: CREATE_AGENT_PROVIDER_DESCRIPTION,
      readOnly: false,
      destructive: false,
      // 每次写入都新建一个文件，与同名并发创建互斥（`wx`），因此不声明并发安全。
      concurrentSafe: false,
      timeoutMs: 10000,
      maxOutputBytes: MAX_CREATE_AGENT_MODEL_BYTES,
      sideEffectScope: "workspace",
      riskLevel: "low",
      needsApproval: false,
    },
    handler,
    formatModelContent: formatCreateAgentModelContent,
    inputSchema: CreateAgentInputJsonSchema,
    outputSchema: CREATE_AGENT_TOOL_OUTPUT_SCHEMA,
    runtimeInputSchema: CreateAgentInputSchema,
    runtimeOutputSchema: CreateAgentOutputSchema,
    permission: {
      permission: "agent.create",
      reason: "CreateAgent writes a new agent definition into the user agent directory",
      riskLevel: "low",
      sideEffectScope: "workspace",
      needsApproval: false,
      patternSources: ["toolName", "input"],
      alwaysAllowPatternSources: ["toolName"],
      denyPriority: "beforeAsk",
    },
    resultBudget: {
      maxInlineBytes: MAX_CREATE_AGENT_MODEL_BYTES,
      maxModelBytes: MAX_CREATE_AGENT_MODEL_BYTES,
      strategy: "truncate",
      preview: { maxBytes: MAX_CREATE_AGENT_MODEL_BYTES, direction: "head" },
    },
    timeout: { defaultMs: 10000, maxMs: 10000, allowCallOverride: false },
    cancellation: {
      supported: true,
      cleanup: "none",
      userVisibleMessage: "CreateAgent was cancelled before the agent file was written",
    },
    trace: {
      required: true,
      propagateToAdapters: true,
      recordInput: "summary",
      recordOutput: "summary",
    },
  };
}

async function executeCreateAgent(
  input: unknown,
  target: CreateAgentTarget,
): Promise<CreateAgentOutput> {
  // 用 safeParse 而不是 parse：输入不合法属于「模型还能改」的可恢复情况，
  // 返回 `invalid` 让模型拿到具体哪一项不合法，而不是把它抛成工具执行失败。
  const parsed = CreateAgentInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const detail = issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "invalid input";
    return {
      status: "invalid",
      name: readRawName(input),
      message: `CreateAgent input is invalid (${detail}). Fix it and try again.`,
    };
  }
  const request = parsed.data as CreateAgentInput;
  const name = request.name.trim();

  // 先查内存里的已启用名单，再交给 `wx` 兜底：禁用中的 agent 不在 profile 列表里，
  // 但它的文件仍存在，只有内核级独占创建才能挡住覆盖。
  const taken = [...RESERVED_AGENT_NAMES, ...target.enabledAgentNames()];
  if (taken.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
    return {
      status: "exists",
      name,
      message: `Agent name is already taken: ${name}. Pick another name or edit the existing definition.`,
    };
  }

  let path: string;
  try {
    ({ path } = await writeUserAgentProfile({
      agentsDir: target.agentsDir,
      profile: {
        name,
        description: request.description,
        systemPrompt: request.systemPrompt,
        ...(request.tools ? { tools: request.tools } : {}),
        ...(request.color ? { color: request.color } : {}),
        ...(request.permissionMode ? { permissionMode: request.permissionMode } : {}),
      },
    }));
  } catch (error) {
    // 按结构化错误码分支：内核 `wx` 撞上禁用成员的既有文件时也算「已存在」，不是失败。
    if (isAgentAlreadyExistsError(error)) {
      return { status: "exists", name, message: error.message };
    }
    if (isInvalidAgentDefinitionError(error)) {
      return { status: "invalid", name, message: error.message };
    }
    throw error;
  }

  const profile = createAgentProfileFromInput({
    agentsDir: target.agentsDir,
    name,
    description: request.description,
    systemPrompt: request.systemPrompt,
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.color ? { color: request.color } : {}),
    ...(request.permissionMode ? { permissionMode: request.permissionMode } : {}),
  });
  target.onCreated(profile);

  return {
    status: "created",
    name,
    path,
    message: `Created agent ${name} at ${path}. @${name} it with SendMessage to give it work.`,
  };
}

/** 输入未通过校验时，尽量回一个名字给模型看（可能为空字符串）。 */
function readRawName(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const name = (input as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

function formatCreateAgentModelContent(output: unknown): string {
  const result = CreateAgentOutputSchema.parse(output);
  return result.message;
}
