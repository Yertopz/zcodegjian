import { StringDecoder } from "node:string_decoder";
import type { Client, ClientChannel } from "ssh2";
import type { ServerProfile } from "@zcode/shared";
import type { ServerWorkbenchDependencies } from "./service.js";
import { ServerApprovalQueue } from "./approvalQueue.js";
import { buildServerCommand } from "./sshConnection.js";
import { parseServerMetrics } from "./metrics.js";
interface ExecutionContext {
  approvals: ServerApprovalQueue;
  desktopGenerations: Map<string, number>;
  generation: (id: string) => number;
  cancellations: Map<string, AbortController>;
  deps: ServerWorkbenchDependencies;
  client: (id: string) => Client;
  profile: (id: string) => ServerProfile;
  metrics: Map<string, import("@zcode/shared").ServerMetrics>;
}
export async function executeServerProposal(
  context: ExecutionContext,
  id: string,
  allow: boolean,
): Promise<void> {
  const { approvals, desktopGenerations, generation, cancellations, deps, client, profile } =
    context;
  const entry = approvals.list().find((p) => p.id === id);
  if (!entry) throw new Error("操作不存在");
  const p = approvals.take(
    id,
    allow,
    entry.action ? (desktopGenerations.get(entry.serverId) ?? -1) : generation(entry.serverId),
  );
  if (!p) return;
  const controller = new AbortController(),
    cancelKey = `${p.serverId}:${p.id}`;
  cancellations.set(cancelKey, controller);
  try {
    let output = "",
      exitCode = 0;
    if (p.action) {
      const result = await deps.desktop({
        op: "input",
        serverId: p.serverId,
        generation: p.generation,
        action: p.action,
        interactionRevision: p.desktopRevision,
      });
      if (!result.ok) throw new Error(result.error || "远程桌面输入失败");
      output = "远程输入已投递，请观察桌面确认效果。";
    } else {
      const c = client(p.serverId),
        command = buildServerCommand(profile(p.serverId), p.command, p.cwd);
      await new Promise<void>((yes, no) => {
        const timer = setTimeout(() => {
          controller.abort();
          no(new Error("命令超时，结果可能未知；不会自动重放"));
        }, 120_000);
        const done = (error?: Error) => {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", cancel);
          if (error) no(error);
          else yes();
        };
        const cancel = () => {
          stream?.close();
          done(new Error("命令已停止，已发生的远端效果不会回滚"));
        };
        let stream: ClientChannel | undefined;
        controller.signal.addEventListener("abort", cancel, { once: true });
        c.exec(command, (error, channel) => {
          if (error) return done(error);
          stream = channel;
          if (controller.signal.aborted) return cancel();
          const decoder = new StringDecoder("utf8");
          const append = (data: Buffer) => {
            output = (output + decoder.write(data)).slice(-64000);
          };
          channel.on("data", append);
          channel.stderr.on("data", append);
          channel.once("error", done);
          channel.once("exit", (code: number) => {
            exitCode = code;
          });
          channel.once("close", () => {
            output += decoder.end();
            done();
          });
        });
      });
    }
    if (
      p.purpose === "metrics" &&
      exitCode === 0 &&
      generation(p.serverId) === p.generation &&
      !controller.signal.aborted
    )
      context.metrics.set(p.serverId, parseServerMetrics(output, p.serverId, p.generation));
    approvals.finish(id, { state: exitCode === 0 ? "completed" : "failed", output, exitCode });
  } catch (e) {
    approvals.finish(id, {
      state: "failed",
      output: e instanceof Error ? e.message : "操作失败",
    });
  } finally {
    cancellations.delete(cancelKey);
  }
}
