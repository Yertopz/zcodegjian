import type { CommandEnvelope, CommandPayloadMap } from "@zcode/shared/zcode-protocol-v4";
import { requireRecord } from "../record-access.js";
import type { V4CommandCoreHost } from "../types.js";

async function setMainAgentPrompt(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<undefined> {
  const record = requireRecord(host, envelope.sessionId);
  const { id } = envelope.payload as CommandPayloadMap["setMainAgentPrompt"];
  if (id !== null) {
    const library = await host.readMainAgentPromptLibrary?.(record.app.sessionId);
    if (!library?.prompts.some((item) => item.id === id))
      throw new Error("Main agent prompt no longer exists");
  }
  await record.app.runtime.setMainAgentPrompt({ id, traceContext: record.traceContext });
  return undefined;
}

export const mainAgentPromptHandlers = { setMainAgentPrompt };
