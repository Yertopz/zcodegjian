import type {
  BrowserConsolePageSnapshot,
  BrowserInstanceColor,
  BrowserInstanceRecord,
  BrowserNetworkEntry,
  BrowserNetworkResponseBodyResult,
  BrowserProxyConfig,
} from "@zcode/shared";
import type { buildBrowserConsoleApplyEditScript } from "@/browser-console/inspectorScript.js";

/** 控制台标签的 renderer 侧状态；持久化只保留 URL/标题，不落盘页面数据。 */
export interface BrowserConsoleTab {
  id: string;
  instanceId: string;
  url: string;
  title: string;
  faviconUrl?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  errorMessage?: string;
  /** 当前 guest 的 webContents id；权限弹窗据此归属。 */
  webContentsId?: number;
  /** 启动恢复的逻辑壳：尚未挂载 webview，激活时才 register + prepare。 */
  suspended?: boolean;
  /** guest 重建代号；递增会让 React 重建 webview 节点。 */
  generation?: number;
}

export interface BrowserConsoleController {
  instances: BrowserInstanceRecord[];
  activeInstanceId: string | null;
  activeInstance: BrowserInstanceRecord | null;
  tabs: BrowserConsoleTab[];
  activeTab: BrowserConsoleTab | null;
  busy: boolean;
  error: string | null;
  networkEntries: BrowserNetworkEntry[];
  networkDropped: number;
  showSensitiveHeaders: boolean;
  deepCaptureTabId: string | null;
  agentBindingInstanceId: string | null;
  aiControlEnabled: boolean;
  selectInstance: (instanceId: string) => void;
  openTab: (instanceId: string, url?: string) => Promise<string | null>;
  closeTab: (tabId: string) => Promise<void>;
  activateTab: (tabId: string) => void;
  updateTab: (tabId: string, patch: Partial<BrowserConsoleTab>) => void;
  createInstance: (input: {
    name: string;
    color?: BrowserInstanceColor;
    proxy?: BrowserProxyConfig;
  }) => Promise<void>;
  updateInstance: (
    id: string,
    patch: { name?: string; color?: BrowserInstanceColor; proxy?: BrowserProxyConfig },
  ) => Promise<void>;
  deleteInstance: (id: string) => Promise<void>;
  clearInstanceData: (id: string, mode: "cache" | "all") => Promise<void>;
  setShowSensitiveHeaders: (value: boolean) => void;
  refreshNetwork: () => Promise<void>;
  clearNetwork: () => Promise<void>;
  exportHar: () => Promise<void>;
  setDeepCapture: (enabled: boolean) => Promise<void>;
  releaseDeepCapture: () => Promise<void>;
  getResponseBody: (requestId: string) => Promise<BrowserNetworkResponseBodyResult>;
  setAiControl: (enabled: boolean) => Promise<void>;
  pageSnapshot: () => Promise<BrowserConsolePageSnapshot>;
  pickElement: () => Promise<unknown>;
  applyEdit: (
    selector: string,
    edit: Parameters<typeof buildBrowserConsoleApplyEditScript>[1],
  ) => Promise<{
    ok: boolean;
    retained: boolean;
    reason?: string;
    readBack?: string;
    previous?: string;
  }>;
  fillForm: (
    values: Record<string, string>,
    onlyVisible: boolean,
  ) => Promise<{
    ok: boolean;
    applied: string[];
    notApplied: string[];
    rejected: string[];
    reason?: string;
  }>;
  /** 由 viewport 组件登记 guest 节点，供检查器脚本执行。 */
  registerWebview: (tabId: string, node: ElectronWebviewTag | null) => void;
  getWebview: (tabId: string) => ElectronWebviewTag | undefined;
}

export function mergeNetworkEntries(
  current: BrowserNetworkEntry[],
  incoming: BrowserNetworkEntry[],
): BrowserNetworkEntry[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) byId.set(entry.id, entry);
  const merged = [...byId.values()];
  return merged.length > 2000 ? merged.slice(merged.length - 2000) : merged;
}
