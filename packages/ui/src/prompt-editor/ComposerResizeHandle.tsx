import { useEffect, useRef } from "react";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function clampComposerHeight(height: number, viewportHeight: number) {
  return Math.max(60, Math.min(height, Math.max(60, Math.min(720, viewportHeight * 0.7))));
}
export function ComposerResizeHandle({
  height,
  onChange,
  inputRef,
}: {
  height?: number;
  onChange: (height: number | undefined) => void;
  inputRef: React.MutableRefObject<LexicalChatInputHandle | null>;
}) {
  const { intl } = useZCodeIntl();
  const drag = useRef<{ y: number; height: number } | null>(null);
  useEffect(() => {
    const resized = () => {
      if (height !== undefined) onChange(clampComposerHeight(height, window.innerHeight));
    };
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, [height, onChange]);
  const label = intl.formatMessage({ id: "chat.composer.resize" });
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={60}
      aria-valuemax={720}
      aria-valuenow={height ?? 80}
      tabIndex={0}
      data-testid="composer-resize"
      title={label}
      className="-mx-1 -mt-2 flex h-3 flex-1 cursor-ns-resize touch-none items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-brand"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const input = event.currentTarget
          .closest("[data-composer-editor-shell]")
          ?.querySelector('[contenteditable="true"]');
        drag.current = {
          y: event.clientY,
          height: height ?? input?.getBoundingClientRect().height ?? 80,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          onChange(
            clampComposerHeight(
              drag.current.height + drag.current.y - event.clientY,
              window.innerHeight,
            ),
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onDoubleClick={() => {
        onChange(undefined);
        inputRef.current?.focus();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          onChange(
            clampComposerHeight(
              (height ?? 80) + (event.key === "ArrowUp" ? 24 : -24),
              window.innerHeight,
            ),
          );
        } else if (event.key === "Home") {
          event.preventDefault();
          onChange(undefined);
        }
      }}
    >
      <span className="h-1 w-10 rounded-full bg-border" />
    </div>
  );
}
