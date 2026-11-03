import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerProfile } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import type { ServerWorkbenchController } from "./useServerWorkbench.js";
import { useServerText } from "./text.js";

export function ServerDesktopPane({
  server,
  controller: c,
  visible,
  onConnect,
}: {
  server: ServerProfile;
  controller: ServerWorkbenchController;
  visible: boolean;
  onConnect: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    t = useServerText(),
    [state, setState] = useState(t.unknown),
    [image, setImage] = useState<string>();
  const lastBounds = useRef("");
  const bounds = useCallback(() => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = window.devicePixelRatio || 1;
    const nativeBounds = {
      x: Math.round(rect.x * scale),
      y: Math.round(rect.y * scale),
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale),
      visible: visible && !document.querySelector('[role="dialog"], [role="menu"]'),
    };
    const serialized = JSON.stringify(nativeBounds);
    if (serialized === lastBounds.current) return;
    lastBounds.current = serialized;
    c.run({
      op: "desktop",
      request: {
        op: "bounds",
        serverId: server.id,
        generation: 0,
        bounds: nativeBounds,
      },
    });
  }, [c.run, server.id, visible]);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(bounds);
    observer.observe(root.current);
    const modals = new MutationObserver(bounds);
    modals.observe(document.body, { childList: true, subtree: true });
    bounds();
    const timer = window.setInterval(() => {
      void c
        .request({ op: "desktop", request: { op: "probe", serverId: server.id, generation: 0 } })
        .then((r) => {
          setState(r.state || t.unknown);
          // helper 重建后需要重新投递相同区域，不能只依赖 DOM resize。
          lastBounds.current = "";
          bounds();
        })
        .catch(() => {});
    }, 2500);
    return () => {
      observer.disconnect();
      modals.disconnect();
      window.clearInterval(timer);
      lastBounds.current = "";
      c.run({
        op: "desktop",
        request: {
          op: "bounds",
          serverId: server.id,
          generation: 0,
          bounds: { x: 0, y: 0, width: 0, height: 0, visible: false },
        },
      });
    };
  }, [bounds, c.request, c.run, server.id, t.unknown]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2 text-ui-caption">
        <span>{state}</span>
        <Button size="sm" variant="outline" onClick={onConnect}>
          {t.connect}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            c.run({
              op: "desktop",
              request: { op: "disconnect", serverId: server.id, generation: 0 },
            })
          }
        >
          {t.disconnect}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void root.current?.requestFullscreen();
          }}
        >
          {t.fullscreen}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void c
              .request({
                op: "desktop",
                request: { op: "capture", serverId: server.id, generation: 0 },
              })
              .then((r) => setImage(r.image))
              .catch(() => {});
          }}
        >
          {t.screenshot}
        </Button>
      </div>
      <div ref={root} className="relative min-h-40 flex-1 bg-black" data-testid="server-desktop">
        <p className="p-5 text-ui-caption text-neutral-400">{t.rdpHint}</p>
      </div>
      {image ? (
        <button className="max-h-32 overflow-auto" onClick={() => setImage(undefined)}>
          <img alt={t.screenshot} src={image} />
        </button>
      ) : null}
    </div>
  );
}
