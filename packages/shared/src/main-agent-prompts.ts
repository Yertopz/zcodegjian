import { z } from "zod";

/**
 * 「多智能体模式」内置主提示词的稳定 id。
 * CLI 工具门（multi-agent-config.ts）与 UI 群聊视图（useGroupChatContext）都以它判定，
 * 两端必须引用同一常量，不允许各自写字面量。
 */
export const MULTI_AGENT_PROMPT_ID = "multi-agent-mode";

export const mainAgentPromptSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500),
    prompt: z.string().trim().min(1).max(50000),
    /**
     * 「追加提示词」：正文之外的第二块编辑区。它不覆盖正文，只在拼装系统提示词时
     * 接在正文下一段（见 composeMainAgentPromptText），用户不必自己把两段粘起来。
     * optional 是为了兼容该字段出现之前已经落盘的主提示词库与本轮快照。
     */
    appendPrompt: z.string().trim().max(50000).optional(),
  })
  .strict();
export type MainAgentPrompt = z.infer<typeof mainAgentPromptSchema>;

/** 正文与追加提示词之间的段落分隔：两段之间空一行，避免直接粘连成一句。 */
const MAIN_AGENT_PROMPT_JOINER = "\n\n";

/**
 * 拼装真正注入系统提示词的正文：正文在前，追加提示词紧接在下一段。
 * 唯一消费点（core/context/builder.ts）必须走这里，不要各自拼字符串，
 * 否则「编辑页看到两份、模型只收到一份」这类漂移会重新出现。
 */
export function composeMainAgentPromptText(
  prompt: Pick<MainAgentPrompt, "prompt" | "appendPrompt">,
): string {
  const append = prompt.appendPrompt?.trim();
  return append ? `${prompt.prompt}${MAIN_AGENT_PROMPT_JOINER}${append}` : prompt.prompt;
}

export const mainAgentPromptLibrarySchema = z
  .object({
    version: z.literal(1),
    prompts: z
      .array(mainAgentPromptSchema)
      .max(100)
      .superRefine((items, context) => {
        if (new Set(items.map((item) => item.id)).size !== items.length) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate main prompt IDs" });
        }
      }),
    defaultId: z.string().max(128).nullable(),
  })
  .strict();
export type MainAgentPromptLibrary = z.infer<typeof mainAgentPromptLibrarySchema>;

/** null 是已固定的默认模式；undefined 仅用于兼容尚未固定快照的旧输入。 */
export const mainAgentPromptSnapshotSchema = mainAgentPromptSchema.nullable();
export type MainAgentPromptSnapshot = z.infer<typeof mainAgentPromptSnapshotSchema>;

export function createDefaultMainAgentPromptLibrary(): MainAgentPromptLibrary {
  return {
    version: 1,
    defaultId: null,
    prompts: [
      {
        id: "example-review",
        name: "代码审查",
        description: "聚焦缺陷、回归风险与证据",
        prompt:
          "以代码审查为主要工作方式。优先定位会影响正确性、安全性和兼容性的具体缺陷，给出文件位置、触发条件、影响与修复建议。区分已确认问题与待验证假设，按严重程度排序；无明确问题时如实说明。用户仅要求审查时先报告发现。",
      },
      {
        id: "example-concise",
        name: "精简回答",
        description: "直接给出结论和必要信息",
        prompt:
          "回答先给结论，使用简洁自然的语言。保留完成任务所需的关键步骤、证据、风险和验证结果，省略重复背景与无关展开。简单问题用短段落回答，复杂任务使用必要的清单。",
      },
      {
        id: "example-design",
        name: "方案设计",
        description: "明确目标、边界、取舍与验收",
        prompt:
          "处理方案设计任务时，先明确目标、现状、约束和成功标准，再给出推荐方案。说明状态所有者、接口、数据流、关键取舍、失败处理、兼容性和验收场景。明确假设与尚待决定的问题，避免把未经验证的推测写成事实。用户要求实施时继续完成实现与验证。",
      },
      {
        id: MULTI_AGENT_PROMPT_ID,
        name: "多智能体模式",
        description: "应用与分配多智能体协作，组建团队、分派任务、汇总结果",
        prompt: [
          "你是多智能体团队的组织者与任务分配者：负责把用户目标拆解为成员任务，用 SendMessage 按名字 @ 对应成员投递工作，跟踪进度并汇总结果向用户汇报。",
          "成员之间是同伴不是下属：可以互相 @ 协作，但不层层分包——任何成员不得再派生子智能体（该限制在工具注册层结构性生效，无需提示词约束）。",
          "创建新成员时遵循 create-multi-agent-team 技能：针对职责编写详细系统提示词（角色、边界、协作接口、输出格式），按最小权限选择工具白名单，按风险设定 permissionMode，并指定不同的 color 便于区分。",
          "@ 次数有共享上限：批量任务合并投递，避免一来一回；额度将尽时收拢协作并向用户汇报剩余进度。",
          "收到成员回传后核对其结果与任务要求是否一致，再继续分派或收口；不要把未经核实的中间结论汇报给用户。",
        ].join("\n"),
      },
    ],
  };
}

export function resolveMainAgentPrompt(
  library: MainAgentPromptLibrary | undefined,
  id: string | null | undefined,
): MainAgentPromptSnapshot {
  return library?.prompts.find((item) => item.id === id) ?? null;
}
