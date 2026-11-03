import { z } from "zod";

export const mainAgentPromptSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500),
    prompt: z.string().trim().min(1).max(50000),
  })
  .strict();
export type MainAgentPrompt = z.infer<typeof mainAgentPromptSchema>;

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
    ],
  };
}

export function resolveMainAgentPrompt(
  library: MainAgentPromptLibrary | undefined,
  id: string | null | undefined,
): MainAgentPromptSnapshot {
  return library?.prompts.find((item) => item.id === id) ?? null;
}
