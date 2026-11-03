import type { Session } from "electron";
import type { BrowserInstanceRecord } from "@zcode/shared";
import {
  buildDesktopCertificateVerifyProc,
  type DesktopNetworkPolicySettings,
} from "../desktopNetworkPolicy.js";
import { buildBrowserInstanceProxyConfig } from "./browserProxyConfig.js";

/**
 * 实例级代理/证书装配。
 *
 * 只负责网络策略：已装配过权限的实例在改代理时走这条路径。重复调用
 * `applyEmbeddedBrowserPermissionPolicy` 会叠加 select-* 监听，也会清空 session-only 授权，
 * 因此不能把整条装配链重跑一遍。
 */
export async function applyBrowserConsoleNetworkPolicy(input: {
  session: Session;
  instance: BrowserInstanceRecord;
  settings: DesktopNetworkPolicySettings;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}): Promise<void> {
  const { session, instance, settings, logger } = input;
  const proxyConfig = buildBrowserInstanceProxyConfig(instance.proxy, {
    httpProxy: settings.httpProxy,
    httpProxyNoProxy: settings.httpProxyNoProxy,
  });
  await session.setProxy(proxyConfig);
  await session.closeAllConnections();
  session.setCertificateVerifyProc(
    buildDesktopCertificateVerifyProc(
      settings,
      {
        allowInsecureCertificates: settings.embeddedBrowserAllowInsecureCertificates === true,
      },
      logger,
    ),
  );
  // 只记录模式，不记录 host/凭据，避免内网代理地址进入日志。
  logger.info(
    `[browser-console] instance network policy applied id=${instance.id} mode=${instance.proxy.mode}`,
  );
}
