import { createHash, randomUUID } from "node:crypto";
import type { ServerProposal, ServerDesktopAction } from "@zcode/shared";
const contentHash = (
  p: Pick<
    ServerProposal,
    | "serverId"
    | "generation"
    | "command"
    | "cwd"
    | "reason"
    | "action"
    | "desktopRevision"
    | "purpose"
  >,
) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        p.serverId,
        p.generation,
        p.command,
        p.cwd,
        p.reason,
        p.action,
        p.desktopRevision,
        p.purpose,
      ]),
    )
    .digest("hex");

/** 不向调用方返回可改写的内部对象；一次性批准只在 Host 中消费。 */
export class ServerApprovalQueue {
  private readonly entries = new Map<string, { proposal: ServerProposal; hash: string }>();
  constructor(private readonly changed: () => void) {}
  list(): ServerProposal[] {
    return [...this.entries.values()].map(({ proposal }) => structuredClone(proposal));
  }
  propose(input: {
    serverId: string;
    generation: number;
    command: string;
    cwd: string;
    reason: string;
    action?: ServerDesktopAction;
    desktopRevision?: number;
    purpose?: "metrics";
  }): string {
    if (this.entries.size >= 200) {
      const finished = [...this.entries].find(
        ([, entry]) => !["pending", "running"].includes(entry.proposal.state),
      );
      if (!finished) throw new Error("待处理操作已达上限，请先处理或取消");
      this.entries.delete(finished[0]);
    }
    const proposal: ServerProposal = {
      ...structuredClone(input),
      id: randomUUID(),
      state: "pending",
      createdAt: Date.now(),
    };
    const hash = contentHash(proposal);
    this.entries.set(proposal.id, { proposal, hash });
    this.changed();
    return proposal.id;
  }
  take(id: string, allow: boolean, generation: number): ServerProposal | null {
    const entry = this.entries.get(id);
    if (!entry || entry.proposal.state !== "pending") throw new Error("该操作已处理、取消或不存在");
    const p = entry.proposal;
    if (
      p.generation !== generation ||
      entry.hash !== contentHash(p) ||
      Date.now() - p.createdAt > 5 * 60_000
    ) {
      p.state = "cancelled";
      this.changed();
      throw new Error("上下文已改变或批准已过期，请重新提议");
    }
    p.state = allow ? "running" : "rejected";
    this.changed();
    return allow ? structuredClone(p) : null;
  }
  finish(id: string, result: Pick<ServerProposal, "state" | "output" | "exitCode">): void {
    const p = this.entries.get(id)?.proposal;
    if (p?.state !== "running") return;
    Object.assign(p, result);
    this.changed();
  }
  cancel(serverId: string, desktopOnly = false): void {
    for (const { proposal } of this.entries.values()) {
      if (
        proposal.serverId === serverId &&
        (!desktopOnly || proposal.action) &&
        ["pending", "running"].includes(proposal.state)
      )
        proposal.state = "cancelled";
    }
    this.changed();
  }
}
