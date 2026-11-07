import type { Session } from "electron";
import type { BrowserInstanceRecord, EmbeddedBrowserPermissionDeviceOption } from "@zcode/shared";
import type { DesktopNetworkPolicySettings } from "../desktopNetworkPolicy.js";
import type {
  EmbeddedBrowserPermissionPolicyOptions,
  EmbeddedBrowserPermissionPromptRequest,
  EmbeddedBrowserPermissionPromptAction,
  EmbeddedBrowserDevicePickerSession,
} from "../embeddedBrowserPermissionPolicy.js";

export type BrowserConsolePermissionPrompt = (
  request: EmbeddedBrowserPermissionPromptRequest,
) => Promise<EmbeddedBrowserPermissionPromptAction>;

export type BrowserConsolePermissionDevicePicker = (input: {
  origin: string;
  permission: string;
  devices: EmbeddedBrowserPermissionDeviceOption[];
  hostWebContentsId?: number;
  guestWebContentsId?: number;
}) => EmbeddedBrowserDevicePickerSession;

export interface BrowserConsolePermissionDeps {
  prompt?: BrowserConsolePermissionPrompt;
  devicePicker?: BrowserConsolePermissionDevicePicker;
  onDisplayMediaRequest?: EmbeddedBrowserPermissionPolicyOptions["onDisplayMediaRequest"];
}

export interface BrowserInstanceSessionDependencies {
  getSession(partition: string): Session;
  applyNetworkPolicy(input: {
    session: Session;
    instance: BrowserInstanceRecord;
    settings: DesktopNetworkPolicySettings;
  }): Promise<void>;
  applyPermissionPolicy(input: {
    session: Session;
    permission: BrowserConsolePermissionDeps;
  }): Promise<void>;
  installRestoreProtocol(protocol: Session["protocol"]): void;
  registerPartition(partition: string): void;
}

/**
 * 装配一个实例的 Electron Session。
 *
 * 顺序不可交换：代理/证书 → 权限闸门 → 恢复协议 → 登记 attach 白名单。
 * 任何一步失败都不得登记 partition，否则后续 `<webview>` 会在没有权限闸门的
 * session 上创建（Electron 默认自动批准所有权限，等于回退 X4）。
 */
export async function prepareBrowserInstanceSession(input: {
  instance: BrowserInstanceRecord;
  settings: DesktopNetworkPolicySettings;
  permission: BrowserConsolePermissionDeps;
  deps: BrowserInstanceSessionDependencies;
}): Promise<Session> {
  const targetSession = input.deps.getSession(input.instance.partition);
  await input.deps.applyNetworkPolicy({
    session: targetSession,
    instance: input.instance,
    settings: input.settings,
  });
  await input.deps.applyPermissionPolicy({
    session: targetSession,
    permission: input.permission,
  });
  input.deps.installRestoreProtocol(targetSession.protocol);
  input.deps.registerPartition(input.instance.partition);
  return targetSession;
}
