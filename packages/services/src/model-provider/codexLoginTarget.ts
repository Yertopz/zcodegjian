import { applyCodexConnection } from "@zcode/provider-node";
import type { ProviderConfigRuntime } from "./providerConfigRuntime.js";
import type {
  ProviderSettingsCodexLogin,
  ProviderSettingsCodexLoginInput,
} from "./providerFacadeServices.js";

/**
 * 桌面端「Codex 登录」的写入出口。
 *
 * 复用 ProviderRuntime 里唯一的那份 personal repository：登录写入与其他设置改动
 * 共用同一个文件锁和同一条刷新链，因此不会出现「UI 保存被登录覆盖」这类双写问题。
 * 凭据与模型目录的读取、代理解析、Provider 规则形状都在 `@zcode/provider-node`，
 * 与 `zcode login codex` 完全同一份实现。
 */
export function createCodexLogin(configRuntime: ProviderConfigRuntime): ProviderSettingsCodexLogin {
  return async (input: ProviderSettingsCodexLoginInput) => {
    const connection = await applyCodexConnection({
      repository: configRuntime.personalRepository,
      env: process.env,
      ...(input.authFilePath ? { authFilePath: input.authFilePath } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.proxyUrl ? { proxyUrl: input.proxyUrl } : {}),
    });
    // 只回传 renderer 需要的两个标识：Host 侧的 Provider 规则形状留在本侧。
    return { providerId: connection.providerId, modelId: connection.modelId };
  };
}
