import { Code2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { useIdeEditorStore, hasIdeSaving } from "@/store/ideEditorStore.js";

export function IdeModeToggle() {
  const { intl } = useZCodeIntl();
  const mode = useZCodeStore((state) => state.interfaceMode);
  const previousMode = useZCodeStore((state) => state.previousInterfaceMode);
  const changeMode = useZCodeStore((state) => state.setInterfaceMode);
  const pending = useIdeEditorStore((state) => state.exitPending || hasIdeSaving(state));
  const label = intl.formatMessage({ id: mode === "ide" ? "ideMode.exit" : "ideMode.enter" });
  return (
    <ControlHintTooltip side="bottom" align="start" title={label}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="ide-mode-toggle"
        data-interface-mode={mode}
        data-active={mode === "ide" || undefined}
        aria-label={label}
        aria-pressed={mode === "ide"}
        disabled={pending}
        className={mode === "ide" ? "text-brand" : undefined}
        onClick={() => void changeMode(mode === "ide" ? previousMode : "ide")}
      >
        <Code2 className="size-4" />
        <span>IDE</span>
      </Button>
    </ControlHintTooltip>
  );
}
