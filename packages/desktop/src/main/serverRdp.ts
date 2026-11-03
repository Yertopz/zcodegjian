import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { app, type BrowserWindow } from "electron";
import {
  serverDesktopRequestSchema,
  type ServerDesktopRequest,
  type ServerDesktopResult,
} from "@zcode/shared";

type Entry = {
  child: ChildProcessWithoutNullStreams;
  generation: number;
  pending: Map<string, (r: ServerDesktopResult) => void>;
};
const entries = new Map<string, Entry>();

/** Main 只管理原生 helper 及窗口；批准与远端运维业务事实属于 Local Host。 */
export async function executeServerDesktop(
  win: BrowserWindow,
  input: ServerDesktopRequest,
): Promise<ServerDesktopResult> {
  const r = serverDesktopRequestSchema.parse(input),
    key = `${win.id}:${r.serverId}`;
  if (process.platform !== "win32")
    return { ok: false, available: false, error: "此平台的内嵌 RDP 适配器尚未就绪" };
  let entry = entries.get(key);
  if (r.op === "disconnect") {
    entry?.child.kill();
    entries.delete(key);
    return { ok: true };
  }
  if (r.op === "probe" && !entry) return { ok: true, available: true };
  if (r.op === "bounds" && !entry) return { ok: true };
  if (r.op === "connect") {
    entry?.child.kill();
    entries.delete(key);
    const manifestRoot = app.isPackaged
      ? join(process.resourcesPath, "server-rdp")
      : join(import.meta.dirname, "../../resources/server-rdp");
    let executable = join(manifestRoot, "ZCode.ServerRdp.exe");
    if (!app.isPackaged) {
      const manifest = JSON.parse(await readFile(join(manifestRoot, "manifest.json"), "utf8")) as {
        hash: string;
      };
      if (!/^[0-9a-f]{16}$/.test(manifest.hash)) throw new Error("RDP helper manifest is invalid");
      executable = join(
        process.env.LOCALAPPDATA!,
        "ZCode-CE/server-rdp",
        manifest.hash,
        "ZCode.ServerRdp.exe",
      );
    }
    const child = spawn(executable, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    entry = { child, generation: r.generation, pending: new Map() };
    entries.set(key, entry);
    const current = entry;
    const gone = () => {
      if (entries.get(key) === current) entries.delete(key);
      for (const resolve of current.pending.values())
        resolve({ ok: false, error: "远程桌面连接已关闭" });
      current.pending.clear();
    };
    child.on("error", gone);
    child.on("exit", gone);
    child.stderr.resume();
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (line.length > 20_000_000) return;
      try {
        const data = JSON.parse(line) as ServerDesktopResult & { id: string };
        const callback = current.pending.get(data.id);
        current.pending.delete(data.id);
        callback?.({
          ok: data.ok,
          error: data.error,
          image: data.image,
          state: data.state,
          interactionRevision: data.interactionRevision,
        });
      } catch {
        /* 原生输出不作为业务命令解析，未知行丢弃。 */
      }
    });
    const ready = new Promise<ServerDesktopResult>((resolve) => {
      const timer = setTimeout(() => {
        current.pending.delete("ready");
        resolve({ ok: false, error: "RDP helper 启动超时" });
      }, 15_000);
      current.pending.set("ready", (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.write(
      JSON.stringify({ parent: win.getNativeWindowHandle().readBigUInt64LE().toString(16) }) + "\n",
    );
    win.once("closed", () => {
      child.kill();
      entries.delete(key);
    });
    const result = await ready;
    if (!result.ok) {
      child.kill();
      return result;
    }
  }
  if (!entry || entry.generation !== r.generation)
    return { ok: false, error: "桌面会话已改变，请重新连接" };
  const id = randomUUID(),
    current = entry;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      current.pending.delete(id);
      resolve({ ok: false, error: "原生操作超时，结果未知，不自动重放" });
    }, 15_000);
    current.pending.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    current.child.stdin.write(JSON.stringify({ ...r, id }) + "\n");
  });
}
