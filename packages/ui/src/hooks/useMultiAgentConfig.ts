import type { MultiAgentRuntimeSettings, MultiAgentSettingsPatch } from "@zcode/shared";
import { useCallback, useEffect, useState } from "react";
import { useServices } from "./useServices.js";
import { logger } from "@/logger.js";

/**
 * 「多智能体」设置的唯一读取/写入入口。
 *
 * 状态所有者在 Host：`~/.zcode/v2/agents-state.json` 的 `multiAgent` 字段
 * （见 `@zcode/shared` 的 multiAgentSettingsSchema）。UI 只做投影，不在本地缓存真相：
 * 每次写入后用服务返回的解析值覆盖本地快照，因此多个设置页同时打开也不会各说各话。
 *
 * CLI 在新建会话时读同一份文件（`bootstrap/src/app/create-app.ts` → `loadZCodeAgentProfiles`），
 * 所以这里的改动只对之后新建的会话生效；页面文案必须如实说明。
 */
export function useMultiAgentConfig() {
  const { subagentsService } = useServices();
  const [settings, setSettings] = useState<MultiAgentRuntimeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const next = await subagentsService.getMultiAgentConfig();
        if (cancelled) return;
        setSettings(next);
        setError(null);
      } catch (cause) {
        logger.warn("[settings] 读取多智能体设置失败", { error: String(cause) });
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subagentsService]);

  const update = useCallback(
    async (patch: MultiAgentSettingsPatch) => {
      const next = await subagentsService.setMultiAgentConfig({ patch });
      setSettings(next);
      return next;
    },
    [subagentsService],
  );

  return { settings, loading, error, update };
}

/**
 * 「谁可以创建智能体」下拉的可选成员：主智能体加上当前已启用的智能体名。
 *
 * 只读一次列表、不订阅 store：这是设置在保存时需要的快照，不是会话内的实时花名册。
 * 读失败按空列表处理（下拉里仍可选主智能体），不让设置页因花名册失败整体不可用。
 */
export function useMultiAgentCreatorOptions(workspacePath: string | null | undefined) {
  const { subagentsService } = useServices();
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    if (!workspacePath) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await subagentsService.list({
          workspacePath,
          mode: "allRuntimeScopes",
        });
        if (cancelled) return;
        const names = new Set<string>();
        for (const agent of result.agents) {
          if (agent.enabled === false) continue;
          if (agent.name.trim().length > 0) names.add(agent.name.trim());
        }
        setOptions([...names].sort((left, right) => left.localeCompare(right)));
      } catch (cause) {
        logger.warn("[settings] 读取可创建智能体的成员列表失败", { error: String(cause) });
        if (!cancelled) setOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subagentsService, workspacePath]);

  return options;
}
