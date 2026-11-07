import type { ProxyConfig } from "electron";
import type { BrowserProxyConfig } from "@zcode/shared";
import {
  buildDesktopProxyConfig,
  normalizeProxyBypassRules,
  normalizeProxyRules,
} from "../desktopNetworkPolicy.js";

/**
 * 实例代理 → Electron Session 代理配置。
 *
 * 与设置页全局代理共用同一套归一化规则（`http://user:pass@host:port` 形态、bypass 列表），
 * 但实例的 `fixed` 模式在端点非法时必须显式失败，不能像全局设置那样静默回落到直连——
 * 否则用户以为流量走了代理，实际是裸连。
 */

export interface InheritedBrowserProxySettings {
  httpProxy?: string;
  httpProxyNoProxy?: string;
}

export class BrowserProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserProxyConfigError";
  }
}

export function buildBrowserInstanceProxyConfig(
  proxy: BrowserProxyConfig,
  inherited: InheritedBrowserProxySettings,
): ProxyConfig {
  switch (proxy.mode) {
    case "inherit":
      // 内置浏览器留空时跟随系统代理，与本机浏览器保持一致；这里复刻同一 fallback。
      return buildDesktopProxyConfig(inherited.httpProxy, inherited.httpProxyNoProxy, "system");
    case "direct":
      return { mode: "direct" };
    case "system":
      return { mode: "system" };
    case "fixed": {
      const rules = normalizeProxyRules(`${proxy.protocol}://${proxy.host}:${proxy.port}`);
      if (!rules) {
        throw new BrowserProxyConfigError("invalid proxy endpoint");
      }
      const config: ProxyConfig = {
        mode: "fixed_servers",
        proxyRules: rules,
      };
      const bypass = normalizeProxyBypassRules(proxy.bypassRules?.join(","));
      if (bypass) config.proxyBypassRules = bypass;
      return config;
    }
  }
}
