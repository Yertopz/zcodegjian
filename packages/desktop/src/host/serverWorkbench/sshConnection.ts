import { Client, type ClientChannel, type SFTPWrapper } from "ssh2";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ServerProfile } from "@zcode/shared";

export class HostTrustRequired extends Error {
  constructor(readonly fingerprint: string) {
    super("请核对服务器主机指纹后重新连接");
  }
}
/** 普通 SSH 通道；不探测系统、不部署 Agent，不复用 POSIX remote deploy。 */
export async function connectServer(
  profile: ServerProfile,
  secret: { password?: string; passphrase?: string; fingerprint?: string },
  signal?: AbortSignal,
): Promise<Client> {
  const client = new Client();
  client.on("error", () => {});
  let observed = "";
  const privateKey = profile.privateKeyPath ? await readFile(profile.privateKeyPath) : undefined;
  signal?.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => {
        client.destroy();
        reject(new Error("连接已取消"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      client.once("ready", resolve);
      client.once("error", (error) => {
        client.destroy();
        const trusted = secret.fingerprint ?? profile.fingerprint;
        reject(observed && trusted !== observed ? new HostTrustRequired(observed) : error);
      });
      client.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: secret.password,
        privateKey,
        passphrase: secret.passphrase,
        readyTimeout: 30_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
        hostVerifier(key: Buffer) {
          observed = `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
          return (secret.fingerprint ?? profile.fingerprint) === observed;
        },
      });
    });
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
  }
  // ready 后也必须监听 error，否则连接抖动可能成为未捕获异常，拖垮整个窗口 Host。
  return client;
}

export function openShell(client: Client, profile: ServerProfile): Promise<ClientChannel> {
  const command =
    profile.os === "windows"
      ? profile.shell === "cmd"
        ? "cmd.exe /d"
        : "powershell.exe -NoLogo -NoProfile"
      : "sh -i";
  return new Promise((resolve, reject) =>
    client.exec(
      command,
      {
        pty: { term: "xterm-256color", cols: 100, rows: 30 },
      },
      (error, stream) => (error ? reject(error) : resolve(stream)),
    ),
  );
}

export function buildServerCommand(profile: ServerProfile, command: string, cwd: string): string {
  if (/[\r\n]/.test(cwd) || cwd.includes("\0")) throw new Error("工作目录不能包含换行或 NUL");
  if (profile.os === "windows") {
    if (profile.shell === "cmd") {
      if (/["&|<>^%!]/.test(cwd))
        throw new Error("CMD 工作目录含有无法安全引用的字符，请使用 PowerShell");
      return `cmd.exe /d /s /c "${cwd ? `cd /d "${cwd}" && ` : ""}${command}"`;
    }
    const script = `$ErrorActionPreference='Stop'; ${cwd ? `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'; ` : ""}${command}`;
    return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
  }
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  return `sh -c ${quote(`${cwd ? `cd -- ${quote(cwd)} && ` : ""}${command}`)}`;
}

export function getSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) =>
    client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp))),
  );
}
