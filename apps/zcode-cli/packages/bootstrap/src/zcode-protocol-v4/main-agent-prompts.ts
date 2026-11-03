import {
  mainAgentPromptSnapshotSchema,
  resolveMainAgentPrompt,
  type MainAgentPromptLibrary,
} from "@zcode/shared";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";

interface MainAgentPromptResolverPorts {
  readLibrary(sessionId: string): Promise<MainAgentPromptLibrary | undefined>;
  getSelection(sessionId: string): string | null | undefined;
  getAdmittedInput(id: string): Promise<{ payload: { [key: string]: unknown } } | null | undefined>;
}

export function createMainAgentPromptResolver(ports: MainAgentPromptResolverPorts) {
  return async (sessionId: string, envelope?: CommandEnvelope) => {
    if (envelope) {
      const stored = await ports.getAdmittedInput(`queue_${envelope.commandId}`);
      const saved = stored?.payload.conversationInputIntent as
        | { mainAgentPrompt?: unknown }
        | undefined;
      // 已接纳输入的明确默认值也必须保留，不能在排队期间借用新版全局设置。
      if (saved && Object.hasOwn(saved, "mainAgentPrompt"))
        return mainAgentPromptSnapshotSchema.parse(saved.mainAgentPrompt);
    }
    const id = ports.getSelection(sessionId);
    if (!id) return null;
    return resolveMainAgentPrompt(await ports.readLibrary(sessionId), id);
  };
}
