import type { IdeContext } from "@zcode/shared";
import { normalizeToolNameAlias } from "../../tool/tool-visibility.js";

const IDE_TOOLS = new Set([
  "Read",
  "Edit",
  "Write",
  "Bash",
  "Glob",
  "Grep",
  "AskUserQuestion",
  "TaskOutput",
  "TaskStop",
]);
/** 只做减法；原权限、工具注册及审批仍由既有 owner 决定。 */
export function isIdeToolAllowed(context: IdeContext | undefined, name: string): boolean {
  return !context || IDE_TOOLS.has(normalizeToolNameAlias(name));
}
