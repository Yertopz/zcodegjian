import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { serverStoredProfileSchema, type ServerProfile } from "@zcode/shared";

/** 按用户约定，仅将 ASCII 字母循环偏移 3 位；逆向处理用于连接，不改变符号和中文。 */
export function shiftServerPassword(value: string, shift = 3): string {
  return value.replace(/[a-zA-Z]/g, (letter) => {
    const base = letter <= "Z" ? 65 : 97;
    return String.fromCharCode(base + ((letter.charCodeAt(0) - base + shift + 26) % 26));
  });
}
type Credentials = { password?: string; rdpPassword?: string };
export function createServerProfileStore(storePath: string) {
  const servers = new Map<string, ServerProfile>();
  const credentials = new Map<string, Credentials>();
  let persistTail = Promise.resolve();
  const persist = () => {
    const content = JSON.stringify(
      [...servers.values()].map(({ hasPassword: _ssh, hasRdpPassword: _rdp, ...p }) => ({
        ...p,
        ...(credentials.has(p.id) ? { credentials: credentials.get(p.id) } : {}),
      })),
    );
    const write = persistTail.then(async () => {
      await mkdir(dirname(storePath), { recursive: true });
      const temp = `${storePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, content, { mode: 0o600 });
        await rename(temp, storePath);
      } finally {
        await rm(temp, { force: true });
      }
    });
    persistTail = write.catch(() => {});
    return write;
  };
  const ready = readFile(storePath, "utf8")
    .then((text) => {
      const records: unknown = JSON.parse(text);
      if (!Array.isArray(records) || records.length > 200)
        throw new Error("服务器配置文件格式错误");
      for (const record of records) {
        const { credentials: saved, ...p } = serverStoredProfileSchema.parse(record);
        if (p.id) {
          servers.set(p.id, p as ServerProfile);
          if (saved) credentials.set(p.id, saved);
        }
      }
    })
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });

  return {
    servers,
    ready,
    persist,
    forget(id: string) {
      credentials.delete(id);
    },
    updateCredentials(
      id: string,
      patch?: { password?: string | null; rdpPassword?: string | null },
    ) {
      const saved = { ...credentials.get(id) };
      for (const key of ["password", "rdpPassword"] as const) {
        if (patch?.[key] === undefined) continue;
        if (patch[key]) saved[key] = shiftServerPassword(patch[key]);
        else delete saved[key];
      }
      if (Object.keys(saved).length) credentials.set(id, saved);
      else credentials.delete(id);
    },
    password(id: string, desktop = false) {
      const value = credentials.get(id)?.[desktop ? "rdpPassword" : "password"];
      return value === undefined ? undefined : shiftServerPassword(value, -3);
    },
    project(p: ServerProfile): ServerProfile {
      const saved = credentials.get(p.id);
      return { ...p, hasPassword: !!saved?.password, hasRdpPassword: !!saved?.rdpPassword };
    },
  };
}
