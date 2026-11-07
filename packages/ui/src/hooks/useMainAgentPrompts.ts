import { useCallback } from "react";
import type { MainAgentPromptLibrary } from "@zcode/shared";
import { useSettings } from "./useSettingService.js";
import { useWorkspaceServices } from "./useWorkspaceServices.js";

export function useMainAgentPrompts(
  workspacePath?: string | null,
  workspaceIdentity?: string | null,
) {
  const { settingService } = useWorkspaceServices(workspacePath, undefined, workspaceIdentity);
  const { settings, loading, error, update, refresh } = useSettings(settingService);
  const save = useCallback(
    async (library: MainAgentPromptLibrary) => {
      await update({ mainAgentPrompts: library });
    },
    [update],
  );
  return { library: settings?.mainAgentPrompts, loading, error, save, refresh };
}
