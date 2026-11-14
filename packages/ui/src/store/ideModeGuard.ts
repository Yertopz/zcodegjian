import { useIdeEditorStore } from "./ideEditorStore.js";
import { useConfirmDialogStore } from "./confirmDialogStore.js";
import { createIdeModeTransition } from "../lib/ideModeTransition.js";
import type { InterfaceMode } from "../lib/interfaceMode.js";
import { toast } from "@/components/ui/toast.js";
import zhCN from "../i18n/locales/zh-CN.js";
import enUS from "../i18n/locales/en-US.js";

/** 弹框属于 UI 适配层，纯状态转换与广播提交由调用方管理。 */
export function createIdeModeGuard(options: {
  getMode: () => InterfaceMode;
  getLocale: () => string;
  commit: (mode: InterfaceMode, fromBroadcast: boolean) => void;
}) {
  const message = (id: keyof typeof zhCN) =>
    (options.getLocale() === "en-US" ? enUS : zhCN)[id] ?? id;
  return createIdeModeTransition({
    ...options,
    editor: useIdeEditorStore,
    confirmDiscard: () =>
      useConfirmDialogStore.getState().requestConfirmation({
        title: message("ideMode.exitConfirm"),
        description: message("ideMode.exitDescription"),
        confirmLabel: message("ideMode.discard"),
        cancelLabel: message("ideMode.cancel"),
        confirmVariant: "destructive",
        testId: "ide-exit-confirm",
      }),
    notifySaving: () => toast(message("ideMode.waitForSave")),
  });
}
