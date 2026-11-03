import { useCallback, useEffect, useState } from "react";
import { usePlatform } from "@/hooks/usePlatform.js";

/**
 * 「AI 控制此浏览器」的 renderer 侧接线。
 *
 * 绑定事实在 main；这里只镜像开关状态并转发用户动作。默认关闭，切换会话即重新读取，
 * 应用重启不恢复。绑定后 main 会把该会话的 newTab 交给常驻控制台，在后台挂载 guest。
 * 主视图选择属于用户：AI 新建/恢复标签与可见性命令不能触发 workspace shell 导航。
 */
export function useBrowserConsoleAgentControl(input: {
  workspaceKey: string;
  sessionId: string | null;
  activeInstanceId: string | null;
  openConsoleTab: (instanceId: string, tabId: string) => void;
  onError: (message: string) => void;
}): {
  agentBindingInstanceId: string | null;
  setAiControl: (enabled: boolean) => Promise<void>;
} {
  const platform = usePlatform();
  const { workspaceKey, sessionId, activeInstanceId, openConsoleTab, onError } = input;
  const [agentBindingInstanceId, setAgentBindingInstanceId] = useState<string | null>(null);

  useEffect(() => {
    if (!platform.browserConsoleGetAgentBinding || !sessionId) {
      setAgentBindingInstanceId(null);
      return;
    }
    let cancelled = false;
    void platform.browserConsoleGetAgentBinding({ workspaceKey, sessionId }).then((result) => {
      if (!cancelled) setAgentBindingInstanceId(result?.instanceId ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [platform, sessionId, workspaceKey]);

  useEffect(() => {
    if (!platform.onBrowserConsoleAgentBindingChanged) return;
    return platform.onBrowserConsoleAgentBindingChanged((payload) => {
      if (payload.workspaceKey !== workspaceKey || payload.sessionId !== sessionId) return;
      setAgentBindingInstanceId(payload.instanceId);
    });
  }, [platform, sessionId, workspaceKey]);

  useEffect(() => {
    if (!platform.onBrowserConsoleOpenTab) return;
    return platform.onBrowserConsoleOpenTab((payload) => {
      if (payload.workspaceKey !== workspaceKey) return;
      // 控制台在对话背后仍常驻；只准备 guest，不抢走用户当前对话和输入焦点。
      openConsoleTab(payload.instanceId, payload.tabId);
    });
  }, [openConsoleTab, platform, workspaceKey]);

  const setAiControl = useCallback(
    async (enabled: boolean) => {
      if (!platform.browserConsoleSetAgentBinding) return;
      if (!sessionId) {
        onError("当前没有活动会话，无法开启 AI 控制");
        return;
      }
      const instanceId = enabled ? activeInstanceId : null;
      const result = await platform.browserConsoleSetAgentBinding({
        workspaceKey,
        sessionId,
        instanceId,
      });
      if (!result?.ok) {
        onError("绑定失败：实例不可用");
        return;
      }
      setAgentBindingInstanceId(instanceId);
    },
    [activeInstanceId, onError, platform, sessionId, workspaceKey],
  );

  return { agentBindingInstanceId, setAiControl };
}
