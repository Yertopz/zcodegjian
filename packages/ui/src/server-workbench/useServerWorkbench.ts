import { useCallback, useEffect, useState, useRef } from "react";
import type { IServerWorkbenchService } from "@zcode/services";
import type { ServerWorkbenchRequest, ServerWorkbenchSnapshot } from "@zcode/shared";
const empty: ServerWorkbenchSnapshot = {
  metrics: [],
  servers: [],
  connections: [],
  terminals: [],
  proposals: [],
  transfers: [],
  messages: [],
  desktopAvailable: false,
};

/** UI 仅保存当前选择和 Host 投影；主视图切换不销毁 Host 的连接、终端或传输。 */
export function useServerWorkbench(service: IServerWorkbenchService | undefined, enabled: boolean) {
  const [snapshot, setSnapshot] = useState(empty);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !service) return;
    let active = true,
      received = false;
    const sub = service.onDidChange((value) => {
      received = true;
      if (active) setSnapshot(value);
    });
    void service
      .snapshot()
      .then((value) => {
        if (active && !received) setSnapshot(value);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      sub.dispose();
    };
  }, [service, enabled]);
  const request = useCallback(
    async (input: ServerWorkbenchRequest) => {
      if (!service) throw new Error("服务器服务不可用，请重启桌面端");
      try {
        setError(null);
        return await service.perform(input);
      } catch (e) {
        setError(e instanceof Error ? e.message : "操作失败");
        throw e;
      }
    },
    [service],
  );
  const run = useCallback(
    (input: ServerWorkbenchRequest) => {
      void request(input).catch(() => {});
    },
    [request],
  );
  const selectedRef = useRef<string | null>(null);
  const select = useCallback(
    (id: string | null, terminal?: string) => {
      if (selectedRef.current && selectedRef.current !== id)
        run({ op: "cancel", serverId: selectedRef.current });
      selectedRef.current = id;
      setSelectedId(id);
      setTerminalId(terminal ?? null);
    },
    [run],
  );
  return { snapshot, selectedId, terminalId, select, request, run, error, setError, service };
}
export type ServerWorkbenchController = ReturnType<typeof useServerWorkbench>;
