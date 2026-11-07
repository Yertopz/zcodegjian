# Codex 登录（本机凭据导入 + 供应商级 SOCKS5 出口）

本规范约束 Codex 登录：把本机已有的 Codex 登录态（`~/.codex/auth.json`）导入为一条 ZCode Provider 连接，并为这条连接单独指定出口代理（SOCKS5 / HTTP）。代理规则本身见 [185-provider-egress-proxy.md](185-provider-egress-proxy.md)，这里只定义「Codex 这条连接怎么被创建出来」。

## 入口

两个入口写的是同一份 Provider 配置，行为完全一致：

| 入口   | 位置                                                                                            | 用法                                                                  |
| ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 设置页 | 设置 → 模型供应商 → 添加供应商 → 第一张卡片 **Codex 登录**                                      | 填 `SK5 代理`（可选）/ 凭据文件（可选）/ 默认模型（可选）后点「登录」 |
| CLI    | `zcode login codex [--proxy socks5h://user:pass@host:port] [--auth-file <path>] [--model <id>]` | 终端里同参数一次写入                                                  |

设置页入口的链路：`ProviderTemplatePicker` 的 Codex 卡片 → `CodexLoginForm` → `useModelProviders().loginCodex` → `IProviderSettingsService.loginCodex` → `createCodexLogin(configRuntime)` → `applyCodexConnection` → `personalRepository.update(...)`。登录成功后 Host 侧 `facade.refresh("codex-login")` 返回新的 `ProviderSettingsView`，UI 用该 View 覆盖本地快照，并像「创建自定义供应商」一样把选中项切到新建的 `codex` 供应商。

设置页代理留空 = 清掉旧的 `network`（回到全局网络设置）；这与 CLI 不传 `--proxy` 等价，避免「取消代理后仍然走旧代理」的静默残留。

## 产品规则

- **不新建 OAuth 流程**：Codex 的登录态由 Codex 自己维护在 `~/.codex/auth.json`（`auth_mode: "chatgpt"` 时含 `tokens.access_token` / `tokens.account_id` / `tokens.refresh_token`）。`zcode login codex` 只读这份文件，不弹浏览器、不占用 `localhost:1455` 回调端口，避免和 Codex CLI 抢同一个回调。
- **一条命令产出一条可用连接**：写完 Provider 规则、模型规则和默认模型选择后，`zcode` 下一次启动就能直接选到 `codex/<model>`，不需要到设置页再手工补字段。
- **按账号工作区选后端域**：`tokens.id_token` 的 `https://api.openai.com/auth` claim 里 `chatgpt_account_is_fedramp` 为 `true` 时，`baseUrl` 写 FedRAMP 边缘域 `https://gov.chatgpt.com/backend-api/codex`（与上游 `FEDRAMP_CODEX_BASE_URL`、`FEDRAMP_CHATGPT_BASE_URL` 同值）；否则写商业域 `https://chatgpt.com/backend-api/codex`。`id_token` 缺失、claim 缺失或 JWT 解不开时按商业域处理，登录结果和 CLI 输出都会点名实际写入的基址，不做无痕兜底。
- **代理属于这条连接**：`--proxy` 给出的代理写进 `ProviderConfig.network`，只作用于 `codex` 这一条连接。同时存在全局 `httpProxy` 时用供应商的，不做叠加；也不受 `noProxy` 截流（理由见 185）。
- **不填 `--proxy` 就走既有全局网络设置**：与其它 Provider 完全一致，登录不会因为缺代理而失败。
- **模型清单来自本机缓存**：`~/.codex/models_cache.json` 是 Codex 自己拉回来的模型目录，含 `slug`、`context_window`、`max_context_window`、`effective_context_window_percent`、`input_modalities`、`supports_search_tool`、`supported_in_api`、`visibility`。只导入 `supported_in_api === true` 且 `visibility === "list"` 的条目；文件不存在时退回到一份已实测的模型 ID 快照（`FALLBACK_CODEX_MODEL_IDS`），但**文件存在却过滤不出任何可见模型时报错**（`Codex 模型缓存没有可用模型`）——被裁剪过的缓存若静默换成快照，会把「缓存过期」伪装成「已经是最新清单」。
- **窗口取值与上游同序**：先取 `context_window`，缺失时退回 `max_context_window`（上游 `ModelInfo::resolved_context_window()` 就是 `context_window.or(max_context_window)`），再按 `effective_context_window_percent` 折算可用窗口。只给 `max_context_window` 的条目同样要能显示窗口。
- **只写有证据的模型属性**：`contextWindow`、`inputFormat`、`supportsToolCall`、`supportsNativeWebSearch` 来自缓存字段；`supportsJsonSchemaOutput` 等缓存里没有的字段不写，交由 185 之外的通用推荐规则决定。
- **凭据不落第二份明文**：access token 以 `access.apiKey` 形式进入 `~/.zcode/provider_config.json`（与其它 Provider 的 API Key 同一份文件、同一套权限）。`id_token` 只在内存里用于判定 FedRAMP 域，不落盘；`refresh_token` 不参与任何流程。

## 数据结构

写入 `PERSONAL_PROVIDER_CONFIG_FILE_NAME`（默认 `~/.zcode/v2/provider_config.json`，可用 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 覆盖）的一条 `providerRules` 记录：

```jsonc
{
  "providerId": "codex",
  "providerName": "Codex",
  "enabled": true,
  "config": {
    "group": "standard-personal",
    "visibility": "visible",
    "access": { "type": "api-key", "apiKey": "<tokens.access_token>" },
    "api": {
      "type": "openai-responses",
      "baseUrl": "https://chatgpt.com/backend-api/codex", // FedRAMP 工作区为 https://gov.chatgpt.com/backend-api/codex
      "headers": {
        "chatgpt-account-id": "<tokens.account_id>",
        "originator": "codex_cli_rs",
      },
    },
    "network": { "type": "socks5h", "host": "127.0.0.1", "port": 1080 },
    "personalModelIds": ["gpt-6-luna", "..."],
    "modelOrder": ["gpt-6-luna", "..."],
  },
}
```

- `api.type = "openai-responses"` 是必须的：它同时决定 AI SDK 侧用 `createOpenAI().responses` 发起 `${baseUrl}/responses`，以及 `transform.ts` 里 codex 风格 `item_reference` 的启用条件。
- `originator: codex_cli_rs` 与 `chatgpt-account-id` 是 ChatGPT 后端识别 Codex 客户端的既有约定；缺 `chatgpt-account-id` 时后端按无团队上下文处理。
- **请求体补 `store: false` 与 `include: ["reasoning.encrypted_content"]`**：Codex 后端按「不留档」处理 Responses 请求，上游构造 `ResponsesApiRequest` 时恒定写这两个字段；而 OpenAI Responses 的默认语义是 `store: true`，一旦不留档，推理内容只能靠响应下发的加密块回放，因此必须显式请求它。两个字段都由 `@zcode/adapters` 的 `openai-responses-json-compat.ts` 在请求带 `originator: codex_cli_rs` 时补齐：`store` 缺失才补 `false`；`include` 缺失则整字段置为 `["reasoning.encrypted_content"]`，已有数组则追加该项（保留调用方为 logprobs 等能力加的条目），非数组形态不猜语义、原样发送。其它 `openai-responses` 连接的请求体保持逐字节不变。
- 每个模型另写一条 `providerModelRules` 记录（`models.setExact(providerId, modelId, config, true)`，即推荐配置而非手动配置），字段稀疏，只含上面「只写有证据的属性」列出的项。
- `defaultModelSelection` 写成 `{ "providerId": "codex", "modelId": "<选中的模型>" }`；`--model` 未给出时用缓存里 `priority` **数值最小**的模型（Codex 的 `priority` 是升序价值，0 最高），缓存文件不存在时用 `DEFAULT_CODEX_MODEL_ID`。

## 接口

`@zcode/bootstrap` 新增 `codex-credentials.ts` 与 `codex-login.ts`：

```ts
export const CODEX_PROVIDER_ID = "codex";
export const CODEX_PROVIDER_NAME = "Codex";
export const CODEX_API_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const CODEX_FEDRAMP_API_BASE_URL = "https://gov.chatgpt.com/backend-api/codex";
export const CODEX_ORIGINATOR = "codex_cli_rs";
export const CODEX_ACCOUNT_ID_HEADER = "chatgpt-account-id";
export const FALLBACK_CODEX_MODEL_IDS: readonly string[];   // 缓存缺失时的内置快照
export const DEFAULT_CODEX_MODEL_ID = FALLBACK_CODEX_MODEL_IDS[0];

interface CodexCredentials {
  readonly accessToken: string;
  readonly accountId: string;
  readonly refreshToken?: string;
  readonly authFilePath: string;
  readonly apiBaseUrl: string;   // 商业域或 FedRAMP gov 域
}
readCodexCredentials(input: { env: EnvRecord; authFilePath?: string }): Promise<CodexCredentials>;

resolveCodexApiBaseUrl(idToken: string | undefined): string;   // 解 JWT payload 的 fedramp claim

interface CodexModelDescriptor {
  readonly modelId: string;
  readonly displayName: string;
  readonly priority: number;
  readonly contextWindow?: number;
  readonly supportsImage: boolean;
  readonly supportsNativeWebSearch: boolean;
  readonly origin: "cache" | "fallback";
}
readCodexModelDescriptors(input: { env: EnvRecord; cacheFilePath?: string }): Promise<readonly CodexModelDescriptor[]>;

parseCodexProxyUrl(raw: string): CodexProxyConfig;   // 裸 host:port 默认 socks5h

loginCodexCli(options: LoginCodexCliOptions): Promise<LoginCodexCliResult>;
```

`LoginCodexCliOptions`：`env`、`authFilePath?`、`cacheFilePath?`、`proxyUrl?`、`modelId?`、`personalProviderConfigPath?`、`providerName?`。
`LoginCodexCliResult`：`{ providerId, providerName, modelId, mainModel, modelIds, modelOrigin, configPath, authFilePath, apiBaseUrl, network? }`；`modelOrigin` 说明模型清单来自 `models_cache.json` 还是内置快照，`apiBaseUrl` 说明实际写入的是商业域还是 FedRAMP 域，CLI 据此提示用户（文本输出：`Endpoint:` 恒定打印实际基址；`modelOrigin = "fallback"` 时多一行 `Model source:`，说明快照来源与「跑一次 Codex 再重跑」的下一步；`--json` 用 `endpoint` 与 `modelOrigin` 字段表达同一件事）。

CLI 入口：`zcode login codex [--proxy socks5h://user:pass@host:port] [--auth-file <path>] [--model <id>]`。`--proxy` 之外的路径覆盖都走 CLI 参数，不新增环境变量。

## 出网路径

```
AiSdkModelExecution
  → toAiSdkProviderConfig(providerConfig)
      networkProxyUrl = buildProviderNetworkProxyUrl(config.network)
  → resolveProviderTransport(providerId, providerConfig)   // 缓存键含 providerId + 代理 URL
  → createNetworkProxyFetch({ directProxyUrl: networkProxyUrl })
  → SocksProxyAgent / ProxyAgent
  → ${baseUrl}/responses        // 商业域 https://chatgpt.com/backend-api/codex，FedRAMP 域 https://gov.chatgpt.com/backend-api/codex
```

代理 URL 参与 transport 缓存键，因此改代理会重建 transport，不会复用旧 agent。

## 已知边界

- **只认 ChatGPT 登录态**：Codex 的 `AuthMode` 共 8 种——`apikey`、`chatgpt`、`chatgptAuthTokens`、`headers`、`agentIdentity`、`personalAccessToken`、`bedrockApiKey`、`bedrockAccessKeys`，只有 `chatgpt` 带 `tokens.account_id`，能构造 ChatGPT 后端认的请求头。其余档位按自身名字拒绝（例：`不是 ChatGPT 登录态（auth_mode=personalAccessToken，个人访问令牌凭据）`），并在同一句里给出下一步「在 Codex 里用 ChatGPT 账号登录一次，或用 `--auth-file` 指定 ChatGPT 凭据」。没有 `auth_mode` 却带 `OPENAI_API_KEY` / `CODEX_API_KEY` 的文件走「API Key 登录态」一档。本机实测的 `~/.codex/auth.json` 是 `auth_mode: "chatgpt"` 形态，且**Codex 把这次登录态用不到的键显式写成 `null`**（`{"OPENAI_API_KEY": null, "tokens": {"access_token": "…", "account_id": "…", "id_token": null, "refresh_token": null}}`）——所以 schema 里所有字段都是 `.nullish()` 而不是 `.optional()`：用 `.optional()` 会把一份完好的 ChatGPT 凭据判成 `expected string, received null` 并让整次登录失败（实测缺陷，由 `packages/provider-node/test/codexLogin.test.ts` 钉住）。
- **access token 过期需重跑命令**：本实现不刷新 token。上游的刷新流程（`TokenRefreshManager`：8 小时间隔 + 过期前 5 分钟窗口）会**轮换 `refresh_token` 并启用重用检测**，第三方若拿同一个 `refresh_token` 去换，Codex 自己的登录态会被判为「已使用/已吊销」而被迫重新登录。因此这里只读 access token：过期后请求返回 401，重跑 `zcode login codex`（或先跑一次 Codex 让 Codex 自己刷新 `auth.json`）即可，代价是要用户手工重跑，收益是不破坏 Codex 的登录态。
- **不写 Codex 的配置**：只读 `~/.codex/auth.json` 与 `~/.codex/models_cache.json`，不改 Codex 自己的 `config.toml`。
- **设置页只能新建或整体重登，不能就地改代理**：`network` 只能在「添加供应商 → Codex 登录」里随登录一起写入；已存在的 `codex` 供应商详情页没有代理编辑控件，改代理要重走一次登录（或直接改 `provider_config.json`）。
- **桌面端 Provider 管理请求不走 SOCKS**：`packages/services/src/providers/api/nodeApiNetwork.ts` 的 undici agent 只支持 http/https 代理，模型请求之外的管理类请求（列模型、校验 Key）不走这条 SOCKS 连接。
- **模型清单是快照**：缓存更新后需要重跑命令才会更新个人模型列表；ZCode 不会在后台轮询 `models_cache.json`。
- **登录时会先探一次代理端口**：登录只写配置、不发模型请求，所以给出的代理若不可达，过去会「登录成功」然后把错误推到首次聊天。现在 `applyCodexConnection` 在写盘前用 `packages/provider-node/src/codex/proxy-probe.ts` 对 `host:port` 做一次 TCP `connect`（3s 超时），失败直接报 `代理无法连接：socks5h://127.0.0.1:7896（拒绝连接，该端口没有监听；请确认代理已启动、端口填写正确）` 并且**不写任何配置**。探测只证明端口开着，不证明对端讲的是 SOCKS5、也不校验账号密码——协议与鉴权错误仍然在首次请求时才暴露。

## 验收场景

1. 本机存在 `~/.codex/auth.json` 且 `auth_mode = "chatgpt"`：`zcode login codex` 返回 `mainModel = codex/<model>`，`provider_config.json` 出现 `providerId = "codex"` 的规则，`api.type = "openai-responses"`、`baseUrl` 指向 `chatgpt.com/backend-api/codex`（FedRAMP 工作区为 `gov.chatgpt.com/backend-api/codex`）、headers 含两项。
2. 带 `--proxy socks5h://127.0.0.1:1080`：落库的 `network` 为 `{type:"socks5h", host:"127.0.0.1", port:1080}`，且模型请求的 transport 使用该代理（`directProxyUrl` 非空）。
3. 带 `--proxy 127.0.0.1:1080`（裸 host:port）：协议推断为 `socks5h`。
4. 带 `--proxy socks5://user:p%40ss@127.0.0.1:1080`：`username` / `password` 解出 `user` / `p@ss`，代理 URL 回写时按 URL 组件重新编码。
5. `--auth-file` 指向不存在的文件：命令失败并提示缺失路径，不写任何配置文件。
6. `auth.json` 缺 `tokens.access_token` 且没有任何 API Key 字段：命令失败并指出缺字段，不写任何配置文件。
7. `auth.json` 是 `codex login --api-key` 的形态（只有 `OPENAI_API_KEY` / `CODEX_API_KEY`，没有 `auth_mode` 也没有 `tokens`）：命令失败并说明「API Key 登录态，本命令只认 ChatGPT 登录态」，不报缺字段。
8. `auth.json` / `models_cache.json` 以 UTF-8 BOM 开头（Windows 上 `Set-Content`、记事本等工具会这么写）：读入前剥掉 BOM，命令照常成功。
9. `models_cache.json` 缺失：使用 `FALLBACK_CODEX_MODEL_IDS`，命令仍然成功。
10. `--model` 指向缓存里不存在的 ID：命令失败并列出可选模型，不静默回退。
11. 重复执行同一命令（换代理）：就地更新同一条 `codex` 规则，不产生第二条 Provider，不残留旧代理字段。
12. 不带 `--proxy`：`network` 字段缺省，其它 Provider 的全局代理行为不受影响。
13. `models_cache.json` 某条目只给 `max_context_window: 400000` 与 `effective_context_window_percent: 95`：模型规则里 `contextWindow = 380000`，不因缺 `context_window` 而丢窗口。
14. `tokens.id_token` 的 payload 含 `{"https://api.openai.com/auth":{"chatgpt_account_is_fedramp":true}}`：落库 `api.baseUrl = https://gov.chatgpt.com/backend-api/codex`，登录结果与 CLI 输出的 `Endpoint:` 同为该值；`id_token` 缺失、不是 JWT、或 claim 缺失时落商业域，登录照常成功。
15. `auth_mode` 为 `personalAccessToken` / `bedrockApiKey` / `bedrockAccessKeys` / `headers` / `agentIdentity` / `chatgptAuthTokens` / `apikey`：错误信息点名具体档位（如 `不是 ChatGPT 登录态（auth_mode=bedrockApiKey，Amazon Bedrock API Key 登录态）`），并给出「在 Codex 里用 ChatGPT 账号登录一次」的下一步，不报缺字段。
16. 模型请求的实际请求体（mock 后端记录）：带 `originator: codex_cli_rs` 的 Codex 调用含 `store: false` 与 `include: ["reasoning.encrypted_content"]`；调用方已带的 `include` 条目保留，齐备的请求体不重复序列化；其它 `openai-responses` 连接的请求体逐字节不变。
17. 登录输出：文本多一行 `Endpoint: <baseUrl>`，`--json` 多一个 `endpoint` 字段，两者与实际写入的 `api.baseUrl` 一致；`models_cache.json` 缺失导致模型清单回退内置快照时，文本多一行 `Model source: built-in snapshot ...`，读到缓存时没有这一行。
18. 设置页「添加供应商」：模板网格第一张卡片是「Codex 登录」（`data-testid=…-template-item-codex-login`），点开后标题切到「Codex 登录」，返回按钮回到模板网格而不是关掉整个选择页；网格里不出现智谱分组，也不出现 `bigmodel-*` / `zai-*-api` 模板卡片，即使内置发行包的 `templateRules` 仍然下发这些 id。
19. 设置页填写 `SK5 代理 = socks5h://127.0.0.1:1080` 并点「登录」：落库的 `network` 为 `{type:"socks5h", host:"127.0.0.1", port:1080}`，列表出现 `codex` 供应商并被自动选中；代理留空再登录一次，`network` 字段消失（对应验收 12 的桌面端等价物）。
20. 登录失败（例如 `~/.codex/auth.json` 不存在）：表单留在原页，详情栏底部出现可重试的失败横幅（`settings.modelProvider.codexLoginFailed.reason`），**横幅带上真实原因**（例：`Codex 登录失败：找不到 Codex 凭据：C:\Users\<用户>\.codex\auth.json`），不只显示固定文案；原因缺失时才回落到 `settings.modelProvider.codexLoginFailed`。
21. `auth.json` 里用不到的可选键写成 `null`（本机真实形态：`OPENAI_API_KEY: null`、`tokens.id_token: null`）：登录照常成功，不报 `expected string, received null`。
22. `--proxy` 指向没有监听的端口（例：`socks5h://127.0.0.1:7896` 而无进程监听）：命令失败并提示 `代理无法连接：…（拒绝连接，该端口没有监听…）`，`provider_config.json` 不被改写；换成有监听的端口或留空代理后登录成功。

## 自动化验证

仓库内没有 E2E 目录，设置页（场景 18-20）用源码级断言兜底，其余场景由服务层与 CLI 测试覆盖：

| 覆盖范围                                                                                                         | 测试文件                                                                                                 | 用例数 |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| 代理解析表、落库 `network`、重登清代理、View 刷新原因 `codex-login`、能力缺失报错                                | `apps/zcode-cli/packages/bootstrap/test/codexLogin.test.ts`、`packages/services/test/codexLogin.test.ts` | 14 / 5 |
| `login codex` 参数到配置写入、输出里的代理脱敏                                                                   | `apps/zcode-cli/packages/cli/test/codexLoginCommand.test.ts`                                             | 6      |
| 智谱预设与智谱模板均已移除、网格首位是 Codex 卡片、表单三字段与空代理剔除、中英双语文案齐全                      | `packages/ui/test/settingsCodexLoginEntry.test.ts`                                                       | 5      |
| `auth.json` 的 `null` 值凭据可读、API Key 登录态与缺 `account_id` 仍拒绝、代理解析与解码、代理端口探测成功与失败 | `packages/provider-node/test/codexLogin.test.ts`                                                         | 6      |

`packages/provider-node` 已登记进 `scripts/run-tests.mjs` 的 `TEST_PACKAGES`：该包没有 `test` 脚本，不登记则上面 6 条断言不会进 `pnpm test`。运行方式：`cd packages/ui && node --import tsx --test test/settingsCodexLoginEntry.test.ts`（其余同构）。
