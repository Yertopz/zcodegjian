import { z } from "zod";
import { modelSelectionSchema } from "./model-selection.js";
import { agentProfileSchema, type AgentProfile } from "./subagent-profile.js";
import {
  AGENT_AVATAR_EMOJI_MAX_LENGTH,
  AGENT_AVATAR_IMAGE_DATA_URL_PATTERN,
  AGENT_AVATAR_IMAGE_MAX_LENGTH,
  type AgentAvatar,
  createAgentStateId,
} from "./subagents-types.js";

/** 「多智能体」模式下主模型与成员共享的 @ 次数上限边界；越界由 schema 直接拒绝。 */
export const MULTI_AGENT_MENTION_LIMIT_MIN = 1;
export const MULTI_AGENT_MENTION_LIMIT_MAX = 32;
export const DEFAULT_MULTI_AGENT_MENTION_LIMIT = 8;
/** 创建者默认是主智能体；成员用 agent 名表示。 */
export const MAIN_AGENT_CREATOR_ID = "main";

/**
 * 多智能体（agent team）设置。状态只存放在 `agents-state.json` 的 `multiAgent`
 * 一处：CLI 每建一个会话读一次，因此改动只对新会话生效，与其它会话级设置同语义。
 */
export const multiAgentSettingsSchema = z
  .object({
    enabled: z.boolean(),
    mentionLimit: z
      .number()
      .int()
      .min(MULTI_AGENT_MENTION_LIMIT_MIN)
      .max(MULTI_AGENT_MENTION_LIMIT_MAX),
    /** 允许调用 CreateAgent 的成员；未设置时为 {@link MAIN_AGENT_CREATOR_ID}。 */
    creatorAgentId: z.string().trim().min(1).optional(),
  })
  .strict();
export type MultiAgentSettings = z.infer<typeof multiAgentSettingsSchema>;

/** 局部更新：UI 每次只改一个字段，缺省字段保留磁盘上的现值。 */
export const multiAgentSettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    mentionLimit: z
      .number()
      .int()
      .min(MULTI_AGENT_MENTION_LIMIT_MIN)
      .max(MULTI_AGENT_MENTION_LIMIT_MAX)
      .optional(),
    creatorAgentId: z.string().trim().min(1).optional(),
  })
  .strict();
export type MultiAgentSettingsPatch = z.infer<typeof multiAgentSettingsPatchSchema>;

/** 已解析的设置：所有消费方只读这一份形状，不在调用点重复写默认值。 */
export interface MultiAgentRuntimeSettings {
  enabled: boolean;
  mentionLimit: number;
  creatorAgentId: string;
}

export function resolveMultiAgentSettings(
  settings: MultiAgentSettings | MultiAgentSettingsPatch | undefined,
): MultiAgentRuntimeSettings {
  return {
    enabled: settings?.enabled === true,
    mentionLimit: settings?.mentionLimit ?? DEFAULT_MULTI_AGENT_MENTION_LIMIT,
    creatorAgentId: settings?.creatorAgentId?.trim() || MAIN_AGENT_CREATOR_ID,
  };
}

/**
 * 头像 schema：两个支路互斥，图片只接受自带 MIME 前缀的 data URL。
 * 长度在上限处直接拒绝而不是截断 —— 静默截断会让 UI 显示一张坏图，比报错更难查。
 */
export const agentAvatarSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("emoji"),
      value: z.string().min(1).max(AGENT_AVATAR_EMOJI_MAX_LENGTH),
    })
    .strict(),
  z
    .object({
      kind: z.literal("image"),
      value: z
        .string()
        .max(AGENT_AVATAR_IMAGE_MAX_LENGTH)
        .regex(AGENT_AVATAR_IMAGE_DATA_URL_PATTERN),
    })
    .strict(),
]);
export type AgentAvatarInput = z.infer<typeof agentAvatarSchema>;

/** `agentAvatars` 的键是 {@link createAgentStateId} 生成的稳定 id。 */
export const agentAvatarsSchema = z.record(z.string().min(1), agentAvatarSchema);

/**
 * 从任意未知值里挑出合法头像；坏值按「没有头像」处理，不阻塞整份状态读取。
 * 逐键容错而不是整表 safeParse：`z.record` 里出现一个坏值会让整张表判失败，
 * 那样用户设过的其它成员头像会被一处手改静默清空 —— 容错粒度必须落到键。
 */
export function parseAgentAvatars(value: unknown): Record<string, AgentAvatar> {
  if (!isPlainRecord(value)) return {};
  const result: Record<string, AgentAvatar> = {};
  for (const [agentId, rawAvatar] of Object.entries(value)) {
    const key = agentId.trim();
    if (!key) continue;
    const parsed = agentAvatarSchema.safeParse(rawAvatar);
    if (parsed.success) result[key] = parsed.data;
  }
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const subagentRuntimeStateSchema = z
  .object({
    disabledAgentIds: z.array(z.string()),
    /** 缺省 = 未开启多智能体模式（旧状态文件的自然回落，不伪造「已解析且关闭」之外的事实）。 */
    multiAgent: multiAgentSettingsSchema.optional(),
    /** 缺省 = 从未设置过头像；旧状态文件无此键，读取即回落空表。 */
    agentAvatars: agentAvatarsSchema.optional(),
    builtInModelSelectionOverrides: z
      .object({
        Explore: modelSelectionSchema.optional(),
        "general-purpose": modelSelectionSchema.optional(),
      })
      .strict(),
    pluginAgentModelSelectionOverrides: z.record(z.string(), modelSelectionSchema),
  })
  .strict();
export type SubagentRuntimeState = z.infer<typeof subagentRuntimeStateSchema>;

/** snapshot 已经解析；读取失败的回退与 RPC 断连错误不能混为一谈。 */
export const subagentRuntimeConfigSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ready"),
      profiles: z.array(agentProfileSchema.refine((profile) => profile.source !== "built-in")),
      builtInModelSelectionOverrides:
        subagentRuntimeStateSchema.shape.builtInModelSelectionOverrides,
      pluginAgentModelSelectionOverrides:
        subagentRuntimeStateSchema.shape.pluginAgentModelSelectionOverrides,
    })
    .strict(),
  z.object({ kind: z.literal("built-in-fallback") }).strict(),
]);
export type SubagentRuntimeConfig = z.infer<typeof subagentRuntimeConfigSchema>;

/** 仅从解析缓存组合结果；启停变化不重新读取或解析 Markdown。 */
export function resolveSubagentRuntimeProfiles(
  profiles: readonly AgentProfile[],
  state: SubagentRuntimeState,
) {
  const disabled = new Set(state.disabledAgentIds);
  return {
    profiles: profiles.filter(
      (profile) =>
        profile.source !== "user" ||
        !disabled.has(createAgentStateId({ name: profile.name, scope: "user", source: "user" })),
    ),
    builtInModelSelectionOverrides: state.builtInModelSelectionOverrides,
    pluginAgentModelSelectionOverrides: state.pluginAgentModelSelectionOverrides,
  };
}
