import { randomUUID } from "node:crypto";
import type { ServerDesktopRequest, ServerDesktopResult } from "@zcode/shared";
export function createServerDesktopBridge(post: (message: unknown) => void) {
  const pending = new Map<string, (r: ServerDesktopResult) => void>();
  return {
    execute(request: ServerDesktopRequest): Promise<ServerDesktopResult> {
      const requestId = randomUUID();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve({ ok: false, error: "桌面操作超时；结果未知，不自动重放" });
        }, 35_000);
        pending.set(requestId, (result) => {
          clearTimeout(timer);
          resolve(result);
        });
        try {
          post({ type: "server-desktop-request", requestId, request });
        } catch {
          clearTimeout(timer);
          pending.delete(requestId);
          resolve({ ok: false, error: "桌面桥已断开" });
        }
      });
    },
    result(id: string, result: ServerDesktopResult) {
      const done = pending.get(id);
      pending.delete(id);
      done?.(result);
    },
  };
}
