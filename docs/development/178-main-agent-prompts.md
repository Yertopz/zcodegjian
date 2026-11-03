# 主提示词设置与会话选择

## 产品约束

设置的 Agent 能力分组管理主提示词（稳定 ID、名称、简介、正文），名称与正文必填。默认选项不追加正文且不可编辑。首次初始化提供代码审查、精简回答、方案设计示例；用户删除后不恢复。设置服务持久化提示词库与新会话默认 ID；每个会话独立持久化所选 ID，旧会话缺省为默认。修改全局默认不改变已有会话。

主提示词只追加到主 Agent 默认系统上下文，不替换 systemPrompt、不使用 outputStyle、不调整权限/工具/计划模式，也不继承给子 Agent 或工作流角色。远程会话读取目标 Host 设置，不新增跨 Host 同步。

## 所有者与时序

提示词库唯一所有者为 ISettingService；选择 ID 的唯一所有者为会话运行时及其配置持久化投影。UI 仅发命令并展示已确认的状态。输入在串行 admission 固定提示词内容；队列、恢复、重试及本轮后续模型调用使用同一快照。编辑后仅后续提交使用新版，忙碌时切换不修改当前轮上下文。guide 不改正在执行轮的系统提示词。

```mermaid
sequenceDiagram
    participant UI
    participant Settings as ISettingService
    participant Session as Session owner
    participant Runtime as Main Agent
    UI->>Settings: 保存库与默认 ID
    UI->>Session: 切换选择并持久化
    Session-->>UI: 命令确认与配置投影
    UI->>Session: 提交输入
    Session->>Settings: 读取最新正文
    Session->>Runtime: admission 固定快照
    Runtime->>Runtime: 构造默认上下文并追加快照
```

删除需确认，提示引用会话下一轮回到默认；失效 ID 统一解释为默认。保存失败保留表单，切换失败保留原选择。配置新增字段均向后兼容；旧数据无需数据库 schema 变更。

## 接口与 UI

共享 schema 校验库、选择 ID 与轮快照；V4 命令/事件/快照同步选择。桌面 continuous 与 Web replayable 使用相同会话事实。设置页支持增删改与默认选择，聊天工具栏在权限控件右侧提供主 Agent 提示词选择器，展示名称、简介与管理入口，避免在输入框上方单独占用一行。遵守 DESIGN.md 的字号、主题、国际化及移动布局约束。

## 验收

- 初始化幂等、删除示例不恢复、增删改校验与重启保留。
- 会话独立选择、新会话默认、旧会话默认、编辑下一轮生效、删除引用回默认。
- 生成中切换、排队、恢复、重试不混用快照；最终模型请求包含正文且默认规则保留；子 Agent 不继承。
- E2E 覆盖新增 → 选择 → 发送 → 模型请求 → 重启/重连，检查手机布局、键盘操作与深浅主题。
- 执行相关测试、typecheck、lint、fmt:check、architecture:check，报告真实结果。

## 运维与验证入口

库保存在既有用户设置的 `mainAgentPrompts`（version=1、prompts、defaultId），首次读取旧设置初始化三个示例，空列表不会重新播种。会话选择保存为 `main_agent_prompt` session entry；输入快照位于 canonical intent 的 `mainAgentPrompt`，null 明确表示默认模式。V4 与仍用于附件 facade 的 legacy session/send 都在提交前固定正文。库上限 100 项，名称 100 字符、简介 500 字符、正文 50000 字符，名称允许重复但 ID 唯一。配置读取失败明确报错，不用旧缓存正文偷偷继续。

针对测试：shared 的 `mainAgentPrompts.test.ts`、core 的 `mainAgentPrompt.test.ts`、bootstrap 的 `mainAgentPrompts.test.ts`。UI 集成测试从仓库根执行 `node --import tsx --test packages/ui/test/mainAgentPrompts.e2e.mjs`，通过 `ZCODE_E2E_CHROMIUM_PATH` 可指定已安装的 Chromium；缺省使用 Playwright 管理的浏览器。测试使用隔离 profile 和临时设置，不连接真实模型或用户配置；最终 provider 请求由真实 AgentRuntime loop + 假模型端口测试检查。
