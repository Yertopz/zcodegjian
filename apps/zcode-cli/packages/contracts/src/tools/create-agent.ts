import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

export const CREATE_AGENT_TOOL_NAME = "CreateAgent";

/** 内置 agent 名不可被用户新建的 agent 覆盖（比较时按小写归一）。 */
export const RESERVED_AGENT_NAMES: readonly string[] = ["general-purpose", "Explore"];

/** agent 名同时是文件名与 `@` 提及目标，因此限制为单段安全字符。 */
export const CREATE_AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const CREATE_AGENT_NAME_MAX_LENGTH = 64;
export const CREATE_AGENT_DESCRIPTION_MAX_LENGTH = 500;
export const CREATE_AGENT_SYSTEM_PROMPT_MAX_LENGTH = 20_000;
export const CREATE_AGENT_TOOL_NAME_MAX_LENGTH = 128;
export const CREATE_AGENT_MAX_TOOLS = 64;

/** 与 AgentProfile frontmatter 支持的颜色一致（packages/shared/src/subagents-types.ts 的 AgentColor）。 */
const AGENT_PROFILE_COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"] as const;

/**
 * 与 profile 解析器实际接受的取值一致（apps/zcode-cli/packages/core/src/subagent/profile.ts
 * 的 VALID_PERMISSION_MODES，即 AgentPermissionMode）：只开放 auto / plan 两个值，
 * 读写闭环无损；bypassPermissions 等更高权限不在用户级 Markdown 输入面开放。
 */
const AGENT_PROFILE_PERMISSION_MODES = ["auto", "plan"] as const;

export const CreateAgentInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(CREATE_AGENT_NAME_MAX_LENGTH)
      .regex(CREATE_AGENT_NAME_PATTERN)
      .describe("Agent id, also the @-mention name: letters, digits, dot, dash or underscore."),
    description: z
      .string()
      .min(1)
      .max(CREATE_AGENT_DESCRIPTION_MAX_LENGTH)
      .describe("One sentence telling the user and teammates what this agent is for."),
    systemPrompt: z
      .string()
      .min(1)
      .max(CREATE_AGENT_SYSTEM_PROMPT_MAX_LENGTH)
      .describe("Markdown body written as the agent's system prompt."),
    tools: z
      .array(z.string().min(1).max(CREATE_AGENT_TOOL_NAME_MAX_LENGTH))
      .max(CREATE_AGENT_MAX_TOOLS)
      .optional()
      .describe("Optional allowlist of tool names; omit to inherit the default toolset."),
    color: z
      .enum(AGENT_PROFILE_COLORS)
      .optional()
      .describe("Avatar color for the group-chat view; pick a distinct color per teammate."),
    permissionMode: z
      .enum(AGENT_PROFILE_PERMISSION_MODES)
      .optional()
      .describe(
        "Permission mode for this agent: read-only teammates use plan, write-capable ones auto; omit to inherit.",
      ),
  })
  .strict();

export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;

export const CreateAgentInputJsonSchema = toToolJsonSchema(CreateAgentInputSchema);

export const CreateAgentOutputSchema = z
  .object({
    status: z.enum(["created", "exists", "invalid"]),
    name: z.string(),
    /** 落盘位置；`exists`/`invalid` 时为空。 */
    path: z.string().optional(),
    message: z.string(),
  })
  .strict();

export type CreateAgentOutput = z.infer<typeof CreateAgentOutputSchema>;

export const CreateAgentOutputJsonSchema = toToolJsonSchema(CreateAgentOutputSchema);
