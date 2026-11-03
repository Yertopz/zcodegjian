import { MessageCirclePlus } from "lucide-react";
import { TID_TASK_NEW_BUTTON } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";
import { runUserAction } from "@/lib/userActionTelemetry.js";

export function NewTaskButtonGroup({
  onCreateTask,
  disabled = false,
}: {
  onCreateTask: () => void;
  disabled?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const newTaskShortcutLabel = useShortcutCommandLabel("newTask");
  return (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      disabled={disabled}
      data-testid={TID_TASK_NEW_BUTTON}
      onClick={() => {
        if (!disabled) {
          runUserAction({
            input: { featureId: "task.lifecycle", action: "create", trigger: "button" },
            operation: onCreateTask,
            completed: { resultSource: "optimistic_projection" },
            failureStage: "task_create",
          });
        }
      }}
      className={cn(
        "group inline-flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2.5 text-left hover:bg-surface-hover hover:text-foreground",
        disabled &&
          "cursor-not-allowed text-foreground-subtlest hover:bg-transparent hover:text-foreground-subtlest",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 text-ui-base">
        <MessageCirclePlus className="size-4 shrink-0" />
        <span className="truncate">{intl.formatMessage({ id: "taskList.newThread" })}</span>
        <span className="ml-auto shrink-0 text-ui-xs font-normal text-foreground-subtlest">
          {newTaskShortcutLabel}
        </span>
      </div>
    </Button>
  );
}
