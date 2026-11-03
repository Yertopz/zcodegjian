import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserNetworkEntry, BrowserNetworkResponseBodyResult } from "@zcode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { mergeNetworkEntries } from "@/browser-console/browserConsoleTypes.js";

/**
 * 网络面板状态：浅采集订阅、CDP 深采集租约、HAR 导出。
 *
 * 数据只给人类 UI；不进入 Agent 上下文。深采集是显式租约，切标签/关面板必须释放，
 * 否则 BrowserGuestManager 的空闲 detach 会被永久抑制。
 */
export function useBrowserConsoleNetwork(input: {
  instanceId: string | null;
  activeTabId: string | null;
  isVisible: boolean;
}): {
  entries: BrowserNetworkEntry[];
  dropped: number;
  showSensitive: boolean;
  deepCaptureTabId: string | null;
  setShowSensitive: (value: boolean) => void;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
  exportHar: () => Promise<void>;
  setDeepCapture: (enabled: boolean) => Promise<void>;
  releaseDeepCapture: () => Promise<void>;
  getResponseBody: (requestId: string) => Promise<BrowserNetworkResponseBodyResult>;
} {
  const platform = usePlatform();
  const { instanceId, activeTabId, isVisible } = input;
  const [entries, setEntries] = useState<BrowserNetworkEntry[]>([]);
  const [dropped, setDropped] = useState(0);
  const [showSensitive, setShowSensitiveState] = useState(false);
  const [deepCaptureTabId, setDeepCaptureTabId] = useState<string | null>(null);
  const instanceRef = useRef<string | null>(instanceId);
  const deepInstanceRef = useRef<string | null>(null);
  instanceRef.current = instanceId;

  const refresh = useCallback(async () => {
    if (!instanceId) return;
    const result = await platform.browserConsoleNetworkSnapshot?.({
      instanceId,
      showSensitiveHeaders: showSensitive,
    });
    if (!result) return;
    setEntries(result.entries);
    setDropped(result.dropped);
  }, [instanceId, platform, showSensitive]);

  const clear = useCallback(async () => {
    if (!instanceId) return;
    await platform.browserConsoleNetworkClear?.({ instanceId });
    setEntries([]);
    setDropped(0);
  }, [instanceId, platform]);

  const exportHar = useCallback(async () => {
    if (!instanceId) return;
    const result = await platform.browserConsoleNetworkExportHar?.({
      instanceId,
      ...(activeTabId ? { tabId: activeTabId } : {}),
      showSensitiveHeaders: showSensitive,
    });
    if (!result?.ok || !result.har) return;
    const blob = new Blob([result.har], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `browser-console-${instanceId}.har`;
    link.click();
    URL.revokeObjectURL(url);
  }, [activeTabId, instanceId, platform, showSensitive]);

  const setDeepCapture = useCallback(
    async (enabled: boolean) => {
      if (!instanceId || !activeTabId) return;
      if (enabled) {
        const result = await platform.browserConsoleAcquireDeepCapture?.({
          instanceId,
          tabId: activeTabId,
        });
        if (!result?.ok) return;
        deepInstanceRef.current = instanceId;
        setDeepCaptureTabId(activeTabId);
        await refresh();
        return;
      }
      await platform.browserConsoleReleaseDeepCapture?.({ instanceId, tabId: activeTabId });
      deepInstanceRef.current = null;
      setDeepCaptureTabId(null);
    },
    [activeTabId, instanceId, platform, refresh],
  );

  const releaseDeepCapture = useCallback(async () => {
    if (!deepCaptureTabId) return;
    const owner = deepInstanceRef.current ?? instanceId;
    if (owner) {
      await platform.browserConsoleReleaseDeepCapture?.({
        instanceId: owner,
        tabId: deepCaptureTabId,
      });
    }
    deepInstanceRef.current = null;
    setDeepCaptureTabId(null);
  }, [deepCaptureTabId, instanceId, platform]);

  const getResponseBody = useCallback(
    async (requestId: string): Promise<BrowserNetworkResponseBodyResult> => {
      if (!instanceId || !activeTabId) return { ok: false, reason: "没有选中的标签" };
      return (
        (await platform.browserConsoleGetResponseBody?.({
          instanceId,
          tabId: activeTabId,
          requestId,
        })) ?? { ok: false, reason: "深采集不可用" }
      );
    },
    [activeTabId, instanceId, platform],
  );

  // 面板可见时才订阅；切走后退订，main 只保留缓冲。
  useEffect(() => {
    if (!isVisible || !instanceId) return;
    void platform.browserConsoleNetworkSubscribe?.({ instanceId, enabled: true });
    void refresh();
    return () => {
      void platform.browserConsoleNetworkSubscribe?.({ instanceId, enabled: false });
    };
  }, [instanceId, isVisible, platform, refresh]);

  useEffect(() => {
    if (!platform.onBrowserConsoleNetworkBatch) return;
    return platform.onBrowserConsoleNetworkBatch((payload) => {
      if (payload.instanceId !== instanceRef.current) return;
      setEntries((current) => mergeNetworkEntries(current, payload.entries));
      setDropped((current) => current + payload.dropped);
    });
  }, [platform]);

  return {
    entries,
    dropped,
    showSensitive,
    deepCaptureTabId,
    setShowSensitive: (value: boolean) => {
      setShowSensitiveState(value);
      if (!instanceId) return;
      void platform
        .browserConsoleNetworkSnapshot?.({ instanceId, showSensitiveHeaders: value })
        .then((result) => {
          if (!result) return;
          setEntries(result.entries);
          setDropped(result.dropped);
        });
    },
    refresh,
    clear,
    exportHar,
    setDeepCapture,
    releaseDeepCapture,
    getResponseBody,
  };
}
