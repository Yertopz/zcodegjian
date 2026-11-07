# 供应商级出口代理（SOCKS5 / HTTP）

本规范约束「某一条模型供应商连接自己走代理」的能力：代理属于该供应商配置，而不是全局开关。用于把 Codex、OpenAI 等直连受限的连接单独挂到 SOCKS5 上，同时保持其它供应商走原来的全局代理或不走代理。

## 产品规则

- **代理挂在供应商配置上**：`ProviderConfig.network` 存在时，该供应商的模型请求全部经它出网；字段缺失时行为与既有版本完全一致（全局 `httpProxy` / `noProxy` / CA）。
- **供应商代理优先于全局代理**：两者同时存在时用供应商的，不做叠加。
- **供应商代理不受 `noProxy` 影响**：本机地址、内网、环境变量里的 `NO_PROXY` 都不参与判定。用户显式给某条连接配代理，就是要求这条连接的所有请求都从代理出去；被 `noProxy` 静默截流会让"配了却没用上"变成难以排查的故障。
- **协议四选一**：`socks5`、`socks5h`、`http`、`https`。`socks5h` 表示域名解析也在代理解端完成。用户名/密码可选，写入代理 URL 时按 URL 组件编码。
- **代理口令与 API Key 同级对待**：它以明文存放在供应商配置里（与 `access.apiKey` 同一份文件、同一套权限）。需要更严格保管时按凭据管理另议，当前实现不做二次加密。

## 数据结构

`@zcode/provider` 的 `providerConfigDataSchema.network`：

```ts
{
  type: "socks5" | "socks5h" | "http" | "https";
  host: string;      // 必填
  port: number;      // 1–65535
  username?: string;
  password?: string;
}
```

- 落库校验用 `completeProviderNetworkProxyDataSchema`（`.strict()`，`host` / `port` 必填）。
- 编辑中的草稿用 `providerNetworkProxyDataSchema`（`host` / `port` 允许为空），避免表单半填状态被判非法。
- `ProviderConfig.network` 是只读对象，`overlay()`、`toJSON()` 以及派生副本（隐藏模型、移出分组、改模型归属）都原样带过去，代理不会因为一次编辑动作丢失。

## 出网路径（CLI 运行时）

```
provider.config.network
  → buildProviderNetworkProxyUrl()            @zcode/provider，拼出 socks5h://user:pass@host:port
  → toAiSdkProviderConfig().networkProxyUrl   apps/zcode-cli/.../model/model-execution.ts
  → resolveProviderTransport()               directProxyUrl（不再传 httpProxy / noProxy）
  → createNetworkProxyFetch()                apps/zcode-cli/.../network/proxy-fetch.ts
  → proxy-agent ProxyAgent                   socks5/socks5h → SocksProxyAgent
```

- `normalizeProxyUrl()` 保留显式 scheme，只对缺 scheme 的输入补 `http://`；因此 `socks5://`、`socks5h://` 能穿过原本只面向 HTTP 代理的归一化逻辑。
- 传输层缓存键包含最终代理 URL（`providerId + "\0" + proxyUrl`）。改了代理地址立即换一条新传输，不会复用旧连接池。
- `socks5h` 让 DNS 在代理解端完成，适合本机 DNS 不可信或被污染的网络。

## 已知边界（未覆盖，不要当成已支持）

- **桌面端供应商管理请求仍只认全局代理**：模型列表、额度、订阅等调用走 `packages/services/src/providers/api/nodeApiNetwork.ts` 的 undici `ProxyAgent`，只支持 `http` / `https`，不支持 SOCKS。要给这些调用加 SOCKS 需要换传输层（undici 自带 SOCKS 支持缺失），属独立改动。
- **目前没有设置页编辑入口**：`network` 只能通过供应商配置文件写入，设置页尚未渲染这几个字段。已落地的唯一命令行写入路径是 `zcode login codex --proxy`（见 [186-codex-login.md](186-codex-login.md)），其它供应商仍需手改文件。
- **代理连通性不在保存时校验**：填错端口不会在保存阶段报错，只会在首次模型请求时以网络错误暴露。原因是不想为一次保存拉一条同步探测链路。

## 验收场景

1. 供应商 `network` 指向 `socks5h://127.0.0.1:1080`，全局 `httpProxy` 指向另一台 HTTP 代理：该供应商的模型请求只出现在 SOCKS5 代理的日志里。
2. 同上，且环境变量 `NO_PROXY` 包含目标域名：请求仍然走 SOCKS5（`noProxy` 不参与）。
3. 删除 `network` 后重新发起请求：回落到全局 `httpProxy` / `noProxy`。
4. 只填 `host` / `port`、不填用户名密码：代理 URL 不含 `@` 段落，握手正常。
5. 运行中把 `network.port` 改掉：下一次请求走新端口（新传输），不沿用旧连接。
