import { randomUUID } from "node:crypto";
import type { ServerTransfer, ServerWorkbenchRequest } from "@zcode/shared";
import type { SFTPWrapper } from "ssh2";
import { transferServerFiles, type TransferCheckpoint } from "./fileTransport.js";
interface QueueContext {
  generation: (id: string) => number;
  sftp: (id: string) => Promise<SFTPWrapper>;
  cancellations: Map<string, AbortController>;
  notify: () => void;
  disposed: () => boolean;
}
/** Host 传输队列的唯一所有者；切换 UI 目标不会改写已入队的服务器、路径和代次。 */
export function createServerTransferQueue({
  generation,
  sftp,
  cancellations,
  notify,
  disposed,
}: QueueContext) {
  const transfers = new Map<string, ServerTransfer>();
  const checkpoints = new Map<string, Map<string, TransferCheckpoint>>();
  const waiting: {
    task: ServerTransfer;
    remote: SFTPWrapper;
    control: AbortController;
    overwrite: boolean;
  }[] = [];
  let runningTransfers = 0;

  const pumpTransfers = () => {
    while (!disposed() && runningTransfers < 2 && waiting.length) {
      const entry = waiting.shift()!,
        { task, remote, control, overwrite } = entry;
      if (control.signal.aborted || generation(task.serverId) !== task.generation) {
        task.state = "cancelled";
        if (cancellations.get(`${task.serverId}:${task.id}`) === control)
          cancellations.delete(`${task.serverId}:${task.id}`);
        notify();
        continue;
      }
      runningTransfers++;
      task.state = "running";
      notify();
      void transferServerFiles({
        sftp: remote,
        task,
        overwrite,
        signal: control.signal,
        changed: notify,
        checkpoints: checkpoints.get(task.id),
      })
        .then(
          () => {
            task.state = "completed";
            task.resumeAvailable = false;
            checkpoints.delete(task.id);
          },
          (e: Error) => {
            task.state = control.signal.aborted ? "cancelled" : "failed";
            task.error = e.message;
          },
        )
        .finally(() => {
          runningTransfers--;
          if (cancellations.get(`${task.serverId}:${task.id}`) === control)
            cancellations.delete(`${task.serverId}:${task.id}`);
          notify();
          pumpTransfers();
        });
    }
  };

  return {
    tasks: transfers,
    async enqueue(r: Extract<ServerWorkbenchRequest, { op: "transfer" }>) {
      if (waiting.length >= 50) throw new Error("待传输任务已达上限");
      const old = r.resumeId ? transfers.get(r.resumeId) : undefined;
      if (
        r.resumeId &&
        (!old ||
          !["failed", "cancelled"].includes(old.state) ||
          !old.resumeAvailable ||
          old.serverId !== r.serverId ||
          old.source !== r.source ||
          old.destination !== r.destination ||
          old.direction !== r.direction)
      )
        throw new Error("旧传输不可恢复或目标已改变");
      const remote = await sftp(r.serverId),
        id = old?.id ?? randomUUID(),
        control = new AbortController();
      const task: ServerTransfer = {
        ...old,
        id,
        serverId: r.serverId,
        generation: generation(r.serverId),
        source: r.source,
        destination: r.destination,
        direction: r.direction,
        state: "queued",
        bytes: old?.bytes ?? 0,
        total: old?.total ?? 0,
        startedAt: Date.now(),
        error: undefined,
      };
      if (transfers.size > 100) {
        const finished = [...transfers.values()].find((t) => t.state === "completed");
        if (finished) transfers.delete(finished.id);
        else throw new Error("请先处理现有传输任务");
      }
      if (!old) checkpoints.set(id, new Map());
      transfers.set(id, task);
      cancellations.set(`${r.serverId}:${id}`, control);
      waiting.push({ task, remote, control, overwrite: Boolean(r.overwrite) });
      notify();
      pumpTransfers();
      return { id };
    },
    cancel(r: Extract<ServerWorkbenchRequest, { op: "transferCancel" }>) {
      const t = transfers.get(r.id);
      if (t) cancellations.get(`${t.serverId}:${t.id}`)?.abort(new Error("user-cancel"));
      pumpTransfers();
      return {};
    },
  };
}
