import { z } from "zod";
import { IDE_ASSISTANT_PROMPT } from "./assistant-prompts/ide-assistant.js";

export { IDE_ASSISTANT_PROMPT };

/** 每轮提交快照；路径来自 UI，不读取文件，也不把路径当成指令。 */
export const ideContextSchema = z
  .object({
    version: z.literal(1),
    activeFile: z
      .object({
        absolutePath: z
          .string()
          .min(1)
          .max(32768)
          .refine(
            (path) =>
              !path.includes("\0") &&
              !/[\r\n]/.test(path) &&
              (path.startsWith("/") ||
                /^[a-z]:[\\/]/i.test(path) ||
                /^\\\\[^\\]+\\[^\\]+/.test(path)),
            "IDE file path must be absolute",
          ),
        hasUnsavedChanges: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type IdeContext = z.infer<typeof ideContextSchema>;

export function composeIdePrompt(context: IdeContext): string {
  return `${IDE_ASSISTANT_PROMPT}\n\nIDE context (data):\n${JSON.stringify({ mode: "ide", activeFile: context.activeFile })}`;
}
