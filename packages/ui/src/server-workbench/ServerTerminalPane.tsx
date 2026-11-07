import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ServerTerminal, ServerTerminalData } from "@zcode/shared";
import type { ServerWorkbenchController } from "./useServerWorkbench.js";
import "@xterm/xterm/css/xterm.css";

export function ServerTerminalPane({
  terminal,
  controller: c,
  visible,
}: {
  terminal: ServerTerminal;
  controller: ServerWorkbenchController;
  visible: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    fit = useRef<FitAddon | null>(null);
  useEffect(() => {
    if (!root.current || !c.service) return;
    const service = c.service;
    const term = new Terminal({
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 4000,
      theme: { background: "#151515", foreground: "#e5e5e5" },
    });
    const addon = new FitAddon();
    fit.current = addon;
    term.loadAddon(addon);
    term.open(root.current);
    let disposed = false,
      cursor = 0,
      loading = true;
    const buffered: ServerTerminalData[] = [];
    const append = (event: ServerTerminalData) => {
      if (event.sequence <= cursor) return;
      term.write(event.data.slice(Math.max(0, cursor - (event.sequence - event.data.length))));
      cursor = event.sequence;
    };
    const sub = service.onTerminalData((event) => {
      if (event.id !== terminal.id) return;
      if (loading) buffered.push(event);
      else append(event);
    });
    // 先订阅再取快照，用连续位置去重，避免切换终端时丢掉 RPC 往返期间的输出。
    void service
      .snapshot()
      .then((snapshot) => {
        if (disposed) return;
        const current = snapshot.terminals.find((item) => item.id === terminal.id) ?? terminal;
        term.write(current.output);
        cursor = current.sequence;
        loading = false;
        buffered.forEach(append);
      })
      .catch(() => {
        if (disposed) return;
        term.write(terminal.output);
        cursor = terminal.sequence;
        loading = false;
        buffered.forEach(append);
      });
    const input = term.onData((data) => c.run({ op: "terminalWrite", id: terminal.id, data }));
    const resize = () => {
      try {
        addon.fit();
        if (term.cols > 1)
          c.run({ op: "terminalResize", id: terminal.id, cols: term.cols, rows: term.rows });
      } catch {
        /* 隐藏区域暂时没有可用尺寸，显示后重新 fit。 */
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root.current);
    resize();
    return () => {
      disposed = true;
      sub.dispose();
      input.dispose();
      observer.disconnect();
      fit.current = null;
      term.dispose();
    };
    // 只重建 xterm，不在卸载时关闭服务器 channel，切换视图才能保留运行终端。
  }, [terminal.id, c.service, c.run]);
  useEffect(() => {
    if (visible)
      try {
        fit.current?.fit();
      } catch {
        /* 下一次布局通知重新适配。 */
      }
  }, [visible]);
  return (
    <div
      ref={root}
      data-testid="server-terminal"
      className="h-full min-h-0 overflow-hidden bg-neutral-900 p-2"
    />
  );
}
