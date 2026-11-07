import { createServerTransferQueue } from "./transferQueue.js";
import { createServerTerminal } from "./terminals.js";
import { serverMetricsCommand } from "./metrics.js";
import { executeServerProposal } from "./approvedExecution.js";
import { runServerAssistant } from "./assistant.js";
import { createServerProfileStore } from "./profileStore.js";
import { randomUUID } from "node:crypto";
import { Emitter } from "@zcode/rpc";
import {
  serverWorkbenchRequestSchema,
  type ServerWorkbenchSnapshot,
  type ServerConnection,
  type ServerTerminal,
  type ServerDesktopRequest,
  type ServerDesktopResult,
} from "@zcode/shared";
import type { IServerWorkbenchService } from "@zcode/services";
import type { Client, ClientChannel, SFTPWrapper } from "ssh2";
import { connectServer, HostTrustRequired, getSftp } from "./sshConnection.js";
import { listServerFiles } from "./fileTransport.js";
import { ServerApprovalQueue } from "./approvalQueue.js";

export interface ServerWorkbenchDependencies {
  storePath: string;
  generate(prompt: string, signal: AbortSignal, image?: string): Promise<string>;
  desktop(request: ServerDesktopRequest): Promise<ServerDesktopResult>;
  desktopAvailable: boolean;
  connect?: typeof connectServer;
}

/** 窗口 Host 专有状态；所有 RPC 写入都先过 shared schema，模型只有无工具文本生成能力。 */
export function createServerWorkbenchService(
  deps: ServerWorkbenchDependencies,
): IServerWorkbenchService & { dispose(): void } {
  const profiles = createServerProfileStore(deps.storePath);
  const { servers, ready, persist } = profiles;
  const connections = new Map<string, ServerConnection>();
  const clients = new Map<string, Client>();
  const desktopGenerations = new Map<string, number>();
  const desktopRevisions = new Map<string, number>();
  const sftps = new Map<string, SFTPWrapper>();
  const terminals = new Map<string, ServerTerminal>();
  const channels = new Map<string, ClientChannel>();
  const cancellations = new Map<string, AbortController>();
  const messages: ServerWorkbenchSnapshot["messages"] = [];
  const metrics = new Map<string, import("@zcode/shared").ServerMetrics>();
  const changed = new Emitter<ServerWorkbenchSnapshot>();
  const dataEvent = new Emitter<import("@zcode/shared").ServerTerminalData>();
  let notifyTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const snapshot = (): ServerWorkbenchSnapshot =>
    structuredClone({
      servers: [...servers.values()].map(profiles.project),
      metrics: [...metrics.values()],
      connections: [...connections.values()],
      terminals: [...terminals.values()],
      proposals: approvals.list(),
      transfers: [...transferQueue.tasks.values()],
      messages,
      desktopAvailable: deps.desktopAvailable,
    });
  const notify = () => {
    if (notifyTimer || disposed) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = undefined;
      if (!disposed) changed.fire(snapshot());
    }, 80);
  };
  const approvals = new ServerApprovalQueue(notify);
  const profile = (id: string) => {
    const p = servers.get(id);
    if (!p) throw new Error("服务器不存在");
    return p;
  };
  const generation = (id: string) => connections.get(id)?.generation ?? 0;
  const client = (id: string) => {
    const c = clients.get(id);
    if (!c || connections.get(id)?.state !== "online") throw new Error("请先连接 SSH");
    return c;
  };
  const sftp = async (id: string) => {
    if (!sftps.has(id)) {
      const owner = client(id),
        gen = generation(id);
      const remote = await getSftp(owner);
      if (generation(id) !== gen || clients.get(id) !== owner) {
        remote.end();
        throw new Error("SFTP 连接已改变");
      }
      if (sftps.has(id)) remote.end();
      else sftps.set(id, remote);
    }
    return sftps.get(id)!;
  };
  const transferQueue = createServerTransferQueue({
    generation,
    sftp,
    cancellations,
    notify,
    disposed: () => disposed,
  });
  const closeTerminal = (id: string) => {
    const terminal = terminals.get(id);
    if (terminal) {
      approvals.cancel(terminal.serverId);
      for (const [key, control] of cancellations)
        if (
          key.startsWith(`${terminal.serverId}:`) &&
          !transferQueue.tasks.has(key.slice(terminal.serverId.length + 1))
        )
          control.abort();
    }
    channels.get(id)?.close();
    channels.delete(id);
    terminals.delete(id);
    notify();
  };
  const invalidate = (id: string) => {
    approvals.cancel(id);
    for (const [key, control] of cancellations)
      if (key.startsWith(`${id}:`)) {
        control.abort();
        cancellations.delete(key);
      }
    for (const terminal of terminals.values())
      if (terminal.serverId === id) closeTerminal(terminal.id);
    sftps.get(id)?.end();
    sftps.delete(id);
    clients.get(id)?.end();
    clients.delete(id);
  };
  const pushMessage = (serverId: string, role: "user" | "assistant", text: string) => {
    messages.push({ id: randomUUID(), serverId, role, text: text.slice(0, 24000) });
    if (messages.length > 100) messages.splice(0, messages.length - 100);
    notify();
  };
  return {
    onDidChange: changed.event,
    onTerminalData: dataEvent.event,
    async snapshot() {
      await ready;
      return snapshot();
    },
    async perform(raw) {
      await ready;
      if (disposed) throw new Error("工作台已关闭");
      const r = serverWorkbenchRequestSchema.parse(raw);
      if (r.op === "desktop") {
        const p = profile(r.request.serverId);
        if (p.os !== "windows") throw new Error("远程桌面仅支持 Windows 目标");
        if (r.request.op === "disconnect" || r.request.op === "connect") {
          approvals.cancel(p.id);
          desktopGenerations.set(p.id, (desktopGenerations.get(p.id) ?? 0) + 1);
        }
        const result = await deps.desktop({
          ...r.request,
          generation: desktopGenerations.get(p.id) ?? 0,
          host: p.rdpHost || p.host,
          port: p.rdpPort,
          username: p.rdpUsername || p.username,
          // 空白连接框使用保存值；两种协议分别取值，不把 SSH 密码误用于另一账号。
          password:
            r.request.op === "connect"
              ? r.request.password || profiles.password(p.id, true)
              : undefined,
        });
        if (!result.ok) throw new Error(result.error || "远程桌面操作失败");
        if (result.interactionRevision !== undefined) {
          const previous = desktopRevisions.get(p.id);
          desktopRevisions.set(p.id, result.interactionRevision);
          if (previous !== undefined && previous !== result.interactionRevision)
            approvals.cancel(p.id, true);
        }
        return result;
      }
      if (r.op === "save") {
        const p = { ...r.profile, id: r.profile.id ?? randomUUID() };
        if (!servers.has(p.id) && servers.size >= 200) throw new Error("最多保存 200 台服务器");
        if (servers.has(p.id)) {
          invalidate(p.id);
          desktopGenerations.set(p.id, (desktopGenerations.get(p.id) ?? 0) + 1);
          await deps
            .desktop({
              op: "disconnect",
              serverId: p.id,
              generation: desktopGenerations.get(p.id)!,
            })
            .catch(() => {});
          connections.set(p.id, {
            serverId: p.id,
            generation: generation(p.id) + 1,
            state: "offline",
          });
        }
        servers.set(p.id, p);
        profiles.updateCredentials(p.id, r.credentials);
        await persist();
        notify();
        return { id: p.id };
      }
      if (r.op === "metrics") {
        const p = profile(r.serverId);
        client(p.id);
        return {
          id: approvals.propose({
            serverId: p.id,
            generation: generation(p.id),
            command: serverMetricsCommand(p),
            cwd: "",
            reason: "采集一次 CPU、内存和系统盘使用率；只读，Linux 采样约一秒。",
            purpose: "metrics",
          }),
        };
      }
      if (r.op === "delete" || r.op === "disconnect") {
        profile(r.serverId);
        invalidate(r.serverId);
        const next = generation(r.serverId) + 1;
        connections.set(r.serverId, { serverId: r.serverId, generation: next, state: "offline" });
        await deps
          .desktop({ op: "disconnect", serverId: r.serverId, generation: next })
          .catch(() => {});
        if (r.op === "delete") {
          servers.delete(r.serverId);
          profiles.forget(r.serverId);
          connections.delete(r.serverId);
          await persist();
        }
        notify();
        return {};
      }
      if (r.op === "connect") {
        const p = profile(r.serverId);
        invalidate(p.id);
        const gen = generation(p.id) + 1;
        connections.set(p.id, { serverId: p.id, generation: gen, state: "connecting" });
        const control = new AbortController(),
          key = `${p.id}:connecting`;
        cancellations.set(key, control);
        notify();
        try {
          const c = await (deps.connect ?? connectServer)(
            p,
            { ...r, password: r.password || profiles.password(p.id) },
            control.signal,
          );
          if (disposed || generation(p.id) !== gen) {
            c.end();
            throw new Error("连接已被取消");
          }
          clients.set(p.id, c);
          connections.set(p.id, { serverId: p.id, generation: gen, state: "online" });
          c.once("close", () => {
            if (generation(p.id) !== gen) return;
            connections.set(p.id, { serverId: p.id, generation: gen + 1, state: "offline" });
            invalidate(p.id);
            notify();
          });
          if (r.fingerprint) {
            p.fingerprint = r.fingerprint;
            await persist();
          }
          notify();
          return {};
        } catch (e) {
          if (generation(p.id) === gen)
            connections.set(p.id, {
              serverId: p.id,
              generation: gen,
              state: "failed",
              error: e instanceof Error ? e.message : "连接失败",
            });
          notify();
          if (e instanceof HostTrustRequired)
            return { trustRequired: true, fingerprint: e.fingerprint };
          throw e;
        } finally {
          if (cancellations.get(key) === control) cancellations.delete(key);
        }
      }
      if (r.op === "terminalCreate")
        return createServerTerminal({
          profile: profile(r.serverId),
          client: client(r.serverId),
          generation: () => generation(r.serverId),
          terminals,
          channels,
          data: (event) => dataEvent.fire(event),
          notify,
        });
      if (r.op.startsWith("terminal")) {
        if (!("id" in r)) throw new Error("缺少终端 id");
        const terminal = terminals.get(r.id);
        if (!terminal) throw new Error("终端不存在");
        if (r.op === "terminalClose") closeTerminal(r.id);
        if (r.op === "terminalRename") {
          terminal.name = r.name;
          notify();
        }
        if (r.op === "terminalWrite" || r.op === "terminalResize") {
          if (generation(terminal.serverId) !== terminal.generation || terminal.exited)
            throw new Error("终端已断开");
          const stream = channels.get(r.id);
          if (!stream) throw new Error("终端不可用");
          if (r.op === "terminalWrite") stream.write(r.data);
          else stream.setWindow(r.rows, r.cols, 0, 0);
        }
        return {};
      }
      if (r.op === "files")
        return listServerFiles(r.serverId ? await sftp(r.serverId) : undefined, r.path);
      if (r.op === "transfer") return transferQueue.enqueue(r);
      if (r.op === "transferCancel") return transferQueue.cancel(r);
      if (r.op === "propose") {
        profile(r.serverId);
        if (!r.action) client(r.serverId);
        const desktop = r.action
          ? await deps.desktop({
              op: "probe",
              serverId: r.serverId,
              generation: desktopGenerations.get(r.serverId) ?? 0,
            })
          : undefined;
        if (r.action && (!desktop?.ok || desktop.state !== "connected"))
          throw new Error("请先连接远程桌面");
        return {
          id: approvals.propose({
            ...r,
            desktopRevision: desktop?.interactionRevision,
            generation: r.action
              ? (desktopGenerations.get(r.serverId) ?? -1)
              : generation(r.serverId),
          }),
        };
      }
      if (r.op === "decide") {
        await executeServerProposal(
          {
            approvals,
            desktopGenerations,
            generation,
            cancellations,
            deps,
            client,
            profile,
            metrics,
          },
          r.id,
          r.allow,
        );
        return {};
      }
      if (r.op === "cancel") {
        approvals.cancel(r.serverId);
        for (const [key, control] of cancellations)
          if (
            key.startsWith(`${r.serverId}:`) &&
            !transferQueue.tasks.has(key.slice(r.serverId.length + 1))
          )
            control.abort();
        return {};
      }
      if (r.op === "assistant")
        return runServerAssistant(
          {
            profile,
            generation,
            desktopGenerations,
            cancellations,
            pushMessage,
            terminals,
            messages,
            clients,
            approvals,
            deps,
          },
          r,
        );
      throw new Error("不支持的服务器操作");
    },
    dispose() {
      disposed = true;
      clearTimeout(notifyTimer);
      for (const id of servers.keys()) invalidate(id);
      changed.dispose();
      dataEvent.dispose();
    },
  };
}
