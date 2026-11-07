# 多智能体（Agent Team）

本规范约束设置页的「多智能体」开关以及它在 CLI 运行时的落点：团队模式下智能体之间用 `SendMessage` 互相 `@`，不再派生子智能体；`@` 次数有上限，并且发送方与接收方都能看到还剩多少次；被指定的「创建者」可以调用 `CreateAgent` 现场创建新成员。视觉与文案规范沿用 `DESIGN.md` 与 `docs/development/181-collaboration-workbench.md` 的协作入口。

## 产品规则

- **开关与上限都在设置页**：设置 → 智能体 → 多智能体，包含启用开关、`@` 次数上限（1–32，默认 8）和创建者（默认主智能体）。
- **团队与分包二选一**：启用多智能体后，任何角色都拿不到派生工具（`Agent` / `Task`）。团队靠 `@` 协作，`@` 用尽即本轮协作结束；让成员再向下层层分包会让次数预算失去意义，也违背「成员之间是同伴而不是下属」的语义。
- **互相 `@` 有上限**：一次父运行时（一个主会话运行时）内所有成员的 `@` 共享同一份额度，额度取设置页的上限；非团队会话保持历史的 32 次，不因为开过团队而被悄悄改小。失败的投递同样消耗额度，用来压住「失败—重试」死循环。
- **双方都看得到剩余次数**：接收方收到的注入提示里带「本会话剩余 @ 次数：N（上限 M）」；发送方在 `SendMessage` 的工具输出里拿到 `mentionsRemaining` / `mentionLimit`。额度用尽后 `SendMessage` 仍然注册（模型可以解释原因），但调用会明确返回失败并引用上限，而不是静默丢弃。
- **按名字拉起成员**：`@名称` 指向尚未运行的成员时，由主智能体所在运行时在后台把它拉起来并把请求内容作为它的首个任务；找不到成员时明确失败并列出可用成员，不做「回退成派生子智能体」的静默降级。
- **一个创建者**：只有设置里指定的创建者（默认主智能体）能调用 `CreateAgent`；其余成员即便被 `@` 起来也没有这个工具。创建出来的成员写入用户级目录，本会话立即可以 `@`，并显示在会话成员面板（未运行也显示）。「立即」是硬约束：`ExploreSubagentPortOptions.profiles` 支持函数形式，`createDefaultSubagentPort` 传的是 `() => config.subagents.profiles` 而不是数组快照——`CreateAgent` 是**替换** `subagents.profiles` 数组（不是原地追加），快照会让新成员在 runner 侧不可见，`@` 直接报 `Unknown team member`。
- **主提示词门（工具层限制）**：主提示词库内置的「多智能体模式」（`id: "multi-agent-mode"`，`packages/shared/src/main-agent-prompts.ts`）被选中时，与设置页团队开关同等生效——`resolveIncludeAgentTool` 返回 false，`Agent` / `Task` 派生工具在**工具注册层**整体下架（初次装配与 shell 快照刷新两个入口共用同一推导）。这是结构性限制，不是提示词约束；主提示词正文只承担协作分工指导，不承担权限约束。子级成员因父级 registry 工具缺席 + `resolveSubagentToolAllowlist` 交集，同样拿不到派生工具。
- **选中即生效（不看时序）**：门读的是「当前选中的主提示词 id」，来源有两个——运行期快照 `config.mainAgentPrompt`（每个 turn 由 envelope 写入）与持久选择 `config.mainAgentPromptId`（`setMainAgentPrompt` / 恢复会话写入），任一等于 `multi-agent-mode` 即成立。原因是两者写入时机都晚于运行时构造：`AgentRuntime` 构造时 `initializeRuntimeTooling` 就把工具表装配完了，而 `config.mainAgentPrompt` 只在 turn 内落值，新建会话的 `mainAgentPromptId` 也在构造之后才 `setMainAgentPrompt`。只读运行期快照就等于「本会话先拿到派生工具、再也摘不掉」。因此选中 / 恢复 / 清空主提示词后必须立即重建模式门工具（`refreshBranchAwareBuiltInTools`），并由 `registerBuiltInTools` 对模式门工具执行下架（`unregister`），不是只跳过注册——工具表是增删双向的。
- **`CreateAgent` 支持权限与颜色**：输入 schema 在 `name` / `description` / `systemPrompt` / `tools` 之外支持 optional `color`（8 色枚举，群聊头像）与 `permissionMode`（`auto` / `plan`——与 profile 解析器 `VALID_PERMISSION_MODES` 一致，更高权限值不在用户级 Markdown 输入面开放），写入 profile frontmatter；解析器（`packages/shared/src/subagent-profile.ts`、`apps/zcode-cli/packages/core/src/subagent/profile.ts`）本就支持这两个键，旧文件向后兼容。
- **团队成员与子智能体分离展示**：`CreateAgent` 落盘时固定写入 `kind: team`（frontmatter 键；`AgentProfile` / `AgentSummary` / `SubAgentConfig` 上的 optional `kind?: "team"`，缺省 = 普通子智能体，旧文件向后兼容）。`parseSubagentMarkdown` / CLI profile 解析器读取该键，@ 提及面板对团队成员显示「多智能体」来源标签；用户手写的无 `kind` profile 仍是普通子智能体，展示与排序照旧。
- **两边各有一条写入路径**：`kind === "team"` 的编辑全部落在设置 → 智能体 → 多智能体 → 「团队成员」（`TeamMembersSection` + `TeamMemberForm`），增删改与头像都在这里；设置 → 智能体 → 子智能体页仍把成员单独归入「多智能体成员」分组（不混入子智能体计数），但该分组是**只读**的——行内不给编辑/删除/启用开关，只给一个「在多智能体设置中管理」链接（`setPendingSettingsSectionIntent("multiAgent")` + 打开设置页）。原因是同一条记录出现两个可写表单时，谁后写谁生效，改名与 `agentAvatars` 的键会互相打架。非成员（`kind` 缺省）在子智能体页的编辑行为不变。
- **协作入口常驻工具表**：`SendMessage` 与 `CreateAgent` 声明 `metadata.alwaysLoad: true`，不声明 `shouldDefer`。团队模式下这两个工具是建队与分派的唯一入口，一旦被 ToolSearch 延后，模型只看到目录名、拿不到 schema，表现为反复输出「我现在向 X 发送…」却不真正发起调用，成员从未启动，界面上只剩子智能体语义——这是可观测的调用链断裂，不是提示词问题。护栏见 `apps/zcode-cli/packages/core/test/collaborationToolExposure.test.ts`（`isDeferredTool` 必须为 false）。
- **卡面身份按 `kind` 区分，不靠改文案**：`AgentToolCallBlock` 用 `configuredAgents` 里同名或同 id 条目的 `kind === "team"` 判定成员，命中时标签取 `chat.toolCall.agent.teamMember`（「多智能体成员」），只有判定不到时才回落 `chat.toolCall.agent.fallback`；成员发起的权限请求徽标取 `chat.interactionOrigin.teamMember`（`data-interaction-origin-badge="team-member"`），判据同为 `kind === "team"`。`@` 面板与设置页早已按 `kind` 分组，这里保持同一判据；侧栏与嵌套来源标签中性化为「智能体」，不再把成员称作子智能体。
- **@ 面板在团队会话里单独列成员**：多智能体模式生效时（主提示词为「多智能体模式」或团队开关打开，判据来自 `composerPromptModeStore` 的当前值，见下条），`@` 面板把 `kind === "team"` 的智能体拆成独立分组 `teamMembers`，排在 `subagents` 之前，标题取 `chat.mention.teamMembers.title`（「团队成员」），空态取 `chat.mention.teamMembers.empty` 并指向设置 → 多智能体 → 团队成员；`subagents` 分组只留非成员，成员不再出现在里面。非团队会话的面板分组顺序保持原样（`subagents` 在前），团队成员分组不出现。两侧共用 `agentMentionLabels` 的来源标签，成员条目额外带 `agentColor` / `agentAvatar` 用于渲染头像。存在团队成员时**不列出**内置 `Explore`（`name === "Explore" && source === "built-in"`，与 runtime `routeTeamMention` 的排除判据同源）——它不是成员，点了只会得到 `Unknown team member`；内置 `general-purpose` 保留（它确实可 `@`），用户自建的同名 `Explore` 也保留（这条排除判据与 runtime `routeTeamMention` 同源，改任一侧都要同步另一侧）。`/` 斜杠菜单不分团队模式，始终把成员与子智能体按名字去重合并成一列（成员在前）。面板每次打开都会 `refreshAgents()` 重取工作区 `AgentSummary`，避免新建成员要刷新页面才出现。
- **当前提示词模式是 UI 侧的全局变量**：`packages/ui/src/store/composerPromptModeStore.ts` 按 `workspaceIdentity || workspacePath` + `::` + `sessionId` 记录「当前选中的主提示词 id / 团队开关」。唯一写入者是 `MainAgentPromptSelector` 的投影 effect（选中、恢复、清空都走这里）；点击「新建任务」/ 新建草稿时 `resetComposerPromptScope` 写一条 `pending` 记录，表示「这个作用域还没选定提示词」，读取方 `resolveComposerMultiAgentMode` 遇到 `pending` 或没有记录时回落到设置里的 `multiAgentEnabled`。写入同值时返回原 state 对象，避免 effect 自我唤醒。选择器与 `@` 面板读这一处；`/` 斜杠菜单不分团队模式；群聊视图走同一个判据函数 `isMultiAgentModeActive`（会话当前主提示词 id + 团队开关）。
- **群聊视图**：会话处于多智能体模式（团队开关开启，或主提示词为「多智能体模式」）时，对话界面自动切换为群聊样式——每条成员消息与回复卡的身份行显示头像 + 名字 + `description` 简称，右侧是回复状态标签；对话右侧另有会话成员面板（见「会话成员面板」节）。`CreateAgent` 新建成员经 `onCreated` 追加进会话 profiles 后立即可见。普通会话渲染路径不变。
- **成员头像**：团队成员可设头像——16 个 emoji 预设之一，或上传本地图片（png/jpeg/webp/gif，≤128 KiB，读成 data URL 存盘；不接受远端 URL，因为头像会原样进 `<img src>`，只放过白名单 mime 的 data URL 是唯一的拦截点）。头像与开关、额度同住在 `agents-state.json#agentAvatars`，键是 agent id；id 由文件名推导，改名时会变，所以写入顺序固定为「先落 Markdown 配置文件 → 拿到返回的 agent → 再写头像」，改名由 `migrateDisabledAgentId` 把头像一起搬过去，否则会留下孤儿头像。渲染统一走 `TeamMemberAvatar`（图片 → emoji → 颜色首字母三级回落），设置列表、表单预览与 `@` 面板共用它。
- **压缩沿用统一管线**：成员会话与主会话共用同一套 compact（auto / microcompact / reactive），不为多智能体单独新增压缩机制。

## 会话成员面板与消息身份

成员身份（头像 + 名字 + 简介）在两处出现，两处都是**只读投影**：

1. **消息身份行**（`TeamMemberIdentityRow`，`variant="inline"` + `descriptionPlacement="inline"`）：`SendMessage` 工具卡（群聊分支）、成员回复卡（`ConversationAgentReply`）与 `Agent`/`Task` 工具总结行在成员名之前渲染同一行身份，群聊消息卡里名字与简介同排（`名字 · 简介`），右侧留给时间。没有这一行时，用户只能看到一串 bare 名字，「谁是谁」要靠记——成员数量一多就失效。`descriptionPlacement` 默认 `below`，面板与设置页保持「名字 / 简介两行」的既有形态。
2. **会话成员面板**（`GroupChatMemberRail`，`variant="panel"`）：对话右侧的成员花名册，头像 + 名字 + 简介 + 状态词，点击打开该成员的会话。

### 消息卡骨架

群聊里两种消息共用同一副骨架 `GroupChatMemberCard`（`packages/ui/src/components/team/`），只换内容与页脚：

```
┌ 头像  名字 · 简介                       11:46 ┐   ← 身份头：单行、右对齐 <time>
│  ↳ 你：@全体 你们好                          │   ← 引用条：本轮触发消息（仅 realUser 行）
│  正文（回复卡 = 成员回复预览；消息卡 = 派单正文）│   ← 正文与名字列对齐（pl-6 = 头像 size-4 + gap-2）
│  正在干活…                    [看过程]       │   ← 页脚：状态文案 + 打开子会话
└──────────────────────────────────────────────┘
```

- **时间**复用既有 `formatMessageTimeLabel`（今天 `HH:mm`，更早给「昨天」或日期），没有可用时间戳就不渲染 `<time>`，头部仍是 `justify-between`。
- **引用条只引用 `origin === "realUser"` 的行**：文本来自 `ConversationTurnGroup` 在 turn 层覆盖的 `turnUserInputText`（本轮首条非空真实用户输入）。后台结果、目标续跑、workflow 启动那些 synthetic 文本不能说成「你说的」；引条最多两行，全文留在 `title`。
- **页脚不给「停下」**：目前没有按子会话停止的用户入口（`session/stop` 是会话级，`task_stop` 是 agent 侧工具展示），凭空造一个按钮会写出第二套停止路径。页脚只有状态文案 + `看过程`（复用 `onOpenSubagentSession`，与成员面板同一入口），无子会话或只读视图时只有状态文案。
- **失败降级成一行灰字**：成员没跑起来（未安装、被拒、被停）时 `SendMessage` 不渲染卡片外框，只留 `名字 · 简介 没能回复：<原因>`（`TID_CHAT_GROUP_CHAT_REPLY_FAILED`，`data-member-status="blocked"`）。给「没有回复」和真回复一样的视觉重量，扫读时会把失败当成交付。原因取既有 `failureMessage`，为空时退回状态词，绝不渲染空的「没能回复：」。
- 非群聊会话不走这条路径：回复卡仍是 `BotIcon` + 名字 + 既有的「的消息 / 正在回复」样式。

数据来源只有两个既有所有者，不新增 store：

| 事实                            | 所有者                                                                                                | 用途                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------- |
| 成员身份（名字/简介/头像/颜色） | `useSubagents(workspacePath, provider, workspaceIdentity)`（`AgentSummary`，只取 `kind === "team"`）  | 面板行与身份行的头像、名字、简介 |
| 运行状态与会话 id               | `useSessionSubagents` 的 `running` 投影（`childSessionId` / `subagentType` / `status` / `startedAt`） | 状态词、可点击性                 |

- **成员身份只能取 `useSubagents`**：`useSubagentsStore.agents` 在 Web 运行路径上**没有 initialize 调用者**，恒为空；曾有版本 `SessionPane` 直读它，于是成员名册、`SendMessage` 身份卡、回复卡全部解析不到成员（页面只剩普通工具卡 + 一行状态文本），表现为「样式没生效」，实际是数据源接错。护栏见 `packages/ui/test/groupChatMemberSourceWiring.test.ts`。
- **回复卡挂在两处**：① `ConversationAgentToolCallRow`（`Agent`/`Task` 工具行配到 `subagent` 行时）；② `SubagentRowView`（裸 `kind: "subagent"` 行）。群聊派单走 **`SendMessage`**，协议不产出 `Agent`/`Task` 工具调用，所以只有①时真实流程永远看不到回复卡。裸行在群聊模式下解析出成员就渲染回复卡，解析不到成员仍是一行 muted 摘要；成员存在但拿不到回复文本（历史会话已结束）时用 `emptyFallback` 降级回同一条摘要。
- **引用条用 flex 排箭头**：`line-clamp-2` 会把引文变成 `-webkit-box`（块级），箭头与引文若做 inline 兄弟，箭头会单独占一行、引文整体下移。箭头为 `shrink-0` 的 flex item，引文 `min-w-0`。
- **成员回复卡必须脱离「已工作」折叠**：回复卡由 `subagent` 行渲染，而 `subagent` 行永远排在最终正文之前，分段器（`buildConversationTurnWorkSegments`）按「可见正文之前的行都是过程记录」把它们归入 `assistantHistory`，于是整张卡被塞进 `CollapsibleContent` 收起，用户只看得到主智能体的转述（`已通过 SendMessage 在后台唤醒…` + 缩进引文），表现为「0ai 的回复不显示在对话上」。修法是显式提升而不是改折叠默认值：`ConversationTimeline` 把群聊模式下能解析出成员的 `subagent` 行 rowId 收集成 `visibleWorkRowIds`，逐层透传到分段器，这些行不进 `assistantHistory`，改由常显的 `assistantWork` 流原位渲染。不用 `assistantHistoryDefaultOpen` 强开——那会把同一段里无关的工具噪音一起展开。历史集合因此可能为空，此时不再渲染「已工作 N 秒」折叠按钮（`ConversationTurnGroup`），否则留下一个点了没反应的死按钮。护栏见 `packages/ui/test/groupChatMemberReplyVisibility.test.ts`。

`buildGroupChatMemberRoster({ agents, running })`（`packages/ui/src/lib/groupChatMembers.ts`）把两者合成 `GroupChatRosterEntry[]`，规则固定：

- **只收 `kind === "team"`**：普通子智能体是「派出去的一次性任务」，不是会话成员，混进来会让花名册长度随派生次数漂移。
- **剔除 `enabled === false` 与空名字**：禁用的成员点不起来，列出来只是噪音。
- **顺序 = 存储顺序**（不做「运行中置顶」）：花名册是身份清册，不是任务队列；按状态重排会让同一个成员在列表里跳动，用户失去位置记忆。状态用颜色 + 文字表达。
- **状态词**：`running` / `waiting` / `blocked` / `idle` → 「运行中 / 等待中 / 受阻 / 未开始」，未运行也显示（`idle`），不留空白。
- **`childSessionId` 只在确有运行时会话时填写**：没有就不渲染成按钮。点击入口不得隐式创建会话——建会话是运行期动作，UI 侧凭点击造出一个 child session id 会让侧栏与运行时脱节。
- **最新一次派单**：同一成员连续被 `@` 多次时取 `startedAt` 最大的一条作为「当前」会话，旧会话仍可从历史里看。

布局与可见性：

- 面板挂在对话列右侧（`SessionPane` 的对话行改 `flex-row`，原对话列包进内层 `flex-col`），`border-l` 分隔，宽 `w-56`，折叠态 `w-11` 只留头像与展开按钮。
- **窄容器自动隐藏**（`hidden … @2xl/conversation:flex`）：对话区宽度是容器查询单位，不是视口——侧栏展开或窗口变窄时，先让面板消失，而不是把消息正文压成一列窄条。**身份行不随之消失**：面板收起时每条消息仍然带头像 + 名字 + 简介，这是「隐藏面板」与「丢失身份」的分界。
- 折叠状态是 `SessionPane` 的局部 `useState`，不持久化、不进 store：它是本次查看的临时偏好，不是服务端事实。
- 面板只在 `groupChatActive && roster.length > 0` 时挂载；没有成员时不渲染空骨架 —— 空态由 `@` 面板与设置页承担。
- 点击行复用既有的 `onOpenSubagentSession`（与子智能体侧栏同一入口），不新增侧栏 tab 类型。
- 两处都不写任何状态：没有乐观更新、没有缓存、没有本地改名。身份的唯一写入路径仍是设置 → 多智能体 → 团队成员。

`Agent`/`Task` 工具总结行只显示头像 + 名字、**不显示简介**：该行由 `ToolSummaryRow` 的 `min-w-0 shrink-0` 容器包住，简介文本无法截断，塞进去会把整行撑出可视区。简介在消息卡与面板里给，那里有横向空间。

## 状态与数据流

```
设置页 MultiAgentSection
  ├→ useMultiAgentConfig → ISubagentsService.setMultiAgentConfig(patch)
  │   → ~/.zcode/v2/agents-state.json 的 multiAgent（唯一所有者）
  └→ 团队成员分区 TeamMembersSection / TeamMemberForm
      ① ISubagentsService.createAgent / updateAgent → ~/.zcode/agents/<name>.md（kind: team）
      ② 拿到 { agent } 后 ISubagentsService.setAgentAvatar({ agentId, avatar })
         → agents-state.json 的 agentAvatars（键 = agent id；改名由 migrateDisabledAgentId 搬）
  → bootstrap 每建会话读一次 → AgentRuntimeConfig.multiAgent（运行期快照）
      ├→ runtime/helpers/multi-agent-config.ts：工具门、@ 上限、创建者目标
      │    ├→ Agent / Task 下架（初次装配 + shell 快照刷新两个入口同一结论；
      │    │    门 = 团队开关开启 或 主提示词 id === "multi-agent-mode"）
      │    └→ CreateAgent 仅创建者注册（还需要 subagents.userAgentsDir）
      ├→ main-agent-prompts（shared）：「多智能体模式」内置提示词，经
      │    AgentRuntimeConfig.mainAgentPrompt 注入主会话 context（builder.ts）
      │    ├→ 选中 / 恢复 / 清空 → setMainAgentPrompt 写 config.mainAgentPromptId
      │    │    → refreshBranchAwareBuiltInTools 立即重跑模式门（下架或加回）
      │    └→ 门的判据 = mainAgentPrompt?.id ?? mainAgentPromptId（两者都可能晚于构造）
      ├→ subagent/peer-message.ts：per-runtime 共享 @ 额度
      │    ├→ 发送方：SubagentSendMessageResult.mentionBudget
      │    └→ 接收方：message-steering 注入剩余次数
      └→ subagent/runner.ts：团队路由（按名字拉起成员，后台任务 + 消息投递）

UI 侧（与运行期快照独立）：
MainAgentPromptSelector ──投影──→ composerPromptModeStore[workspaceKey::sessionId]
                                     ├→ MentionPlugin（@ 面板 teamMembers 分组）
                                     └→ resolveComposerMultiAgentMode（pending 时回落设置开关）
新建任务 / 新建草稿 ──resetComposerPromptScope──→ 同上，写 pending 记录
```

- 设置只写在 `agents-state.json`，不进 `AppSettings`：它是智能体域的运行时事实，桌面/Web/CLI 共用同一份文件。
- CLI 每次建会话读一次开关，因此**改动对已有会话不生效**，只影响新会话；这是刻意选择的边界——中途换协作模型会让已发出的 `@` 与额度语义前后不一致。
- 团队模式下 `SendMessage` 的语义扩展为「按名字拉起或投递」；非团队会话的行为完全不变。

## 接口契约

| 位置                                                                     | 契约                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/subagent-runtime-config.ts`                         | `multiAgentSettingsSchema`（严格，`mentionLimit` 1–32）、`DEFAULT_MULTI_AGENT_MENTION_LIMIT`、`MAIN_AGENT_CREATOR_ID`、`MultiAgentRuntimeSettings`、`resolveMultiAgentSettings()`                                                                                                              |
| `packages/services/src/subagents/subagentsService.ts`                    | `getMultiAgentConfig()` / `setMultiAgentConfig({ patch })`；patch 校验后整文件写回，保留其余字段。`createAgent` / `updateAgent` 返回 `{ agent }`（头像写入要用真实 id）；`setAgentAvatar({ agentId, avatar })` 写 `agentAvatars`，`deleteAgent` 顺带清键，改名由 `migrateDisabledAgentId` 迁移 |
| `packages/shared/src/subagents-types.ts`                                 | `AgentAvatar`（`emoji` / `image`）、`AgentAvatars`、`AgentSummary` 的 `kind` / `color` / `avatar`、`AgentAvatarSetParams`、`AGENT_AVATAR_EMOJI_MAX_LENGTH` / `AGENT_AVATAR_IMAGE_MAX_LENGTH` / `AGENT_AVATAR_IMAGE_DATA_URL_PATTERN`                                                           |
| `packages/shared/src/subagent-runtime-config.ts`                         | `agentAvatarSchema` / `agentAvatarsSchema` / `parseAgentAvatars`（逐键校验，单个坏值不牵连整张表）、`subagentRuntimeStateSchema.agentAvatars`                                                                                                                                                  |
| `packages/ui/src/store/composerPromptModeStore.ts`                       | UI 侧「当前是否多智能体模式」的唯一来源：作用域键 `workspaceIdentity \|\| workspacePath` + `::` + `sessionId`、`markComposerPromptScopePending`、`syncComposerPromptScope`、`resetComposerPromptScope`、`resolveComposerMultiAgentMode`（`pending`/无记录时回落 `multiAgentEnabled`）          |
| `packages/ui/src/lib/multiAgentMode.ts`                                  | `isMultiAgentModeActive({ mainAgentPromptId, multiAgentEnabled })`：主提示词 id 为 `multi-agent-mode` 或团队开关开启                                                                                                                                                                           |
| `packages/ui/src/mentions/providers/agentsMentionProvider.ts`            | `mapAgentsToMentionItems(agents, { locale, teamMode })`：剔除 `kind === "team"`、名字去重、`teamMode` 下隐藏内置 `Explore`                                                                                                                                                                     |
| `packages/ui/src/mentions/providers/teamMembersMentionProvider.ts`       | `mapTeamMembersToMentionItems(agents, { locale })`：只取 `kind === "team"`，id 前缀 `team-member:`（`category` 仍是 `subagents`，靠前缀与面板分组区分）                                                                                                                                        |
| `packages/ui/src/mentions/mentionPanelRouting.ts`                        | `TEAM_CONTEXT_GROUP_ORDER`（`teamMembers` 置顶）、`getMentionPanelGroupOrder(trigger, { teamMode })`                                                                                                                                                                                           |
| `packages/ui/src/settings/TeamMembersSection.tsx`                        | 团队成员唯一写入路径：列表/增删改 + 头像二次写入；写后 `refreshLoadedSubagentsStoreForWorkspace`                                                                                                                                                                                               |
| `packages/ui/src/settings/TeamMemberForm.tsx`                            | 成员表单（名字/描述/颜色/模型/工具/权限模式/系统提示词/头像）；提交返回 `{ config, avatar }`，`kind: "team"` 固定                                                                                                                                                                              |
| `packages/ui/src/settings/teamMemberAvatarInput.ts`                      | `checkTeamMemberAvatarFile()`（mime 白名单 + `128 * 1024` 上限）、`normalizeTeamMemberAvatarDataUrl()`（只放行图片 data URL）                                                                                                                                                                  |
| `packages/ui/src/components/team/TeamMemberAvatar.tsx`                   | 成员头像三级回落：图片 → emoji → 颜色首字母；`size: xs \| sm \| md \| lg`                                                                                                                                                                                                                      |
| `packages/ui/src/components/team/TeamMemberIdentityRow.tsx`              | `{ name, description?, avatar?, color?, variant: "inline" \| "panel", status?, statusLabel? }`：身份行唯一渲染出口，消息卡 / 回复卡 / 工具行 / 成员面板共用；根节点是 `<span>`，可安全嵌进 `ToolSummaryRow` 的 `<span>`                                                                        |
| `packages/ui/src/lib/groupChatMembers.ts`                                | `buildGroupChatMemberRoster({ agents, running })`、`resolveGroupChatMember(agents, nameOrId)`、`normalizeGroupChatMemberName()`、`GroupChatRosterEntry`、`GroupChatMemberStatus`：只读合成，只取 `kind === "team"` 且 `enabled !== false`，顺序 = 存储顺序                                     |
| `packages/ui/src/v4/GroupChatMemberRail.tsx`                             | 会话成员面板：`members` / `collapsed` / `onToggleCollapsed` / `onOpenMember`；无 `childSessionId` 的行走静态分支；窄容器由 `@2xl/conversation` 隐藏                                                                                                                                            |
| `packages/ui/src/hooks/useMultiAgentConfig.ts`                           | 设置页读写入口；`useMultiAgentCreatorOptions()` 取创建者候选                                                                                                                                                                                                                                   |
| `apps/zcode-cli/packages/core/src/runtime/helpers/multi-agent-config.ts` | `resolveIncludeAgentTool`、`resolveIncludeCreateAgentTool`、`resolvePeerMessageBudgetLimit`、`resolveRuntimeCreateAgentTarget`；两个工具注册入口共用这一份推导                                                                                                                                 |
| `apps/zcode-cli/packages/contracts/src/tools/create-agent.ts`            | `CreateAgent` 名称、保留名、名字正则、各项上限、输入/输出 schema；optional `color` / `permissionMode`                                                                                                                                                                                          |
| `packages/services/src/subagents/subagentMarkdown.ts`                    | 用户级 agent Markdown 的 frontmatter 解析/序列化（`kind: team` 等）                                                                                                                                                                                                                            |
| `apps/zcode-cli/packages/core/src/subagent/profile-writer.ts`            | Markdown 序列化 + `wx` 独占创建；结构化错误码 `agent_already_exists` / `agent_invalid_definition`                                                                                                                                                                                              |
| `apps/zcode-cli/packages/contracts/src/interfaces/subagent.port.ts`      | `SubagentMentionBudget`、`SubagentSendMessageResult.mentionBudget`、`delivery: "launched"`                                                                                                                                                                                                     |

`CreateAgent` 是用户级写入（`<storageRoot>/agents/<name>.md`），磁盘先行、成功后才把 profile 替换进本会话的 `subagents.profiles`（`onCreated` 写的是全新数组）；因此新建成员不必重开会话就能被 `@`，而写盘失败不会留下「内存里有、磁盘上没有」的幽灵成员。runner 侧必须按引用现读这份配置（`readProfiles()` 按数组引用做记忆化，引用不变时零成本），否则拿到的还是构造期的旧数组。

重复判定分两层：先查内存名单（保留名 + 已启用成员，大小写不敏感），再交给内核 `wx` 兜底——被禁用的成员不在 profile 列表里，但它的文件还在，只有独占创建才能挡住覆盖。两层都映射为 `status: "exists"`，不是失败。

## 失败与边界

- **额度用尽**：返回失败并引用上限（`Peer message limit reached for this session runtime (limit N).`），`SendMessage` 仍在工具表里，模型可以据此向用户解释。
- **未知成员**：失败并列出当前可用成员名；**没有启用成员**（只剩内置 `Explore`）时提示去设置页启用，绝不静默退回派生子智能体。
- **成员之间的 `@`**：只能投递到当前正在运行的同伴（共享同一份额度）；把某个成员「拉起」是主智能体的职责，成员不承担启动其他成员的责任。
- **创建者缺席**：`creatorAgentId` 指向的成员不在团队里时，没有任何运行时拿到 `CreateAgent`；主智能体仍可 `@` 成员，只是没人能建新人。
- **配置损坏**：`agents-state.json` 缺失或字段非法时回落到默认值（启用=false、上限=8、创建者=main）并记录 warn，不阻塞会话；非法 `mentionLimit` 在设置页写入时就被 schema 拒绝，不会落盘。
- **头像写失败**：配置文件已落盘、头像写失败时只提示保存头像失败，成员本身保持可用（Markdown 是事实源，头像只是附带状态）；不要在此时回滚成员文件——那会把一次设置失败变成一次成员丢失。
- **未选主提示词**：新建任务后作用域是 `pending`，此时团队判据回落到设置里的团队开关，`@` 面板照常工作；选过一次提示词后以选中值为准，直到下次新建任务重置。
- **成员面板无会话可开**：成员还没跑过（`idle`）或运行已结束且投影里没有 `childSessionId` 时，面板行是静态行、不可点；点击不创建会话。成员已被删除但旧消息里还留着名字时，身份行回落到消息自带的名字（无头像 → 首字母色块），不报错、不显示「未知成员」。
- **不做**：没有团队成员白名单（团队 = 当前已启用的 agent + 本会话新建的成员）；没有用户侧「群聊发言人路由」——UI 里的 `@名称` 仍然只表达任务意图，是否 `@` 由主智能体决定；成员之间不递归分包。

## 验收

- `packages/shared/test/multiAgentSettings.test.ts`：schema 边界（0 / 33 / 非整数 / 多余字段）、默认值、patch 语义。
- `packages/services/test/subagentsMultiAgentConfig.test.ts`：首次写入物化完整对象、保留其余状态字段、非法 patch 不落盘。
- `packages/ui/test/settingsMultiAgentSection.test.ts`：设置区块结构、testid、非法上限的提示文案、i18n 键齐全；团队成员分区挂载、成员只列 `kind === "team"`、成员编辑只有一条写入路径（子智能体页只跳转）、成员文案中英成对。
- `packages/ui/test/composerPromptModeStore.test.ts`：模式判据真值表、作用域键按 identity 优先、`pending`/无记录时回落设置开关、新建任务清作用域、同值写入返回同一 state 对象（防 effect 自唤醒）。
- `packages/ui/test/teamMemberAvatar.test.ts`：头像 mime 白名单、`128 * 1024` 字节边界、data URL 归一（只放行图片 data URL、超长拒绝）、emoji 上限能容下带变体选择符的单个 emoji。
- `packages/services/test/subagentsAgentAvatar.test.ts`：头像写入/读取、非法头像被 schema 拒绝、删除成员清头像、改名迁移头像。
- `packages/ui/test/collaborationMentions.test.ts`：`@` 分组顺序（默认 vs 团队模式）、成员独立分组且只含 `kind === "team"`、成员 id 前缀 `team-member:`、同名去重与来源标签；团队模式下内置 `Explore` 不列出而 `general-purpose` 保留；无成员时 `Explore` 照常可 `@`。
- `apps/zcode-cli/packages/core/test/agentTeam.test.ts`：团队模式下 `Agent` / `Task` 缺席且 shell 快照刷新后仍缺席、`SendMessage` 保留；`CreateAgent` 只出现在创建者手里；`@` 上限取设置值并递减、用尽后报出上限；接收方注入提示带剩余次数；按名字拉起成员 / 未知成员 / 内置成员；`CreateAgent` 落盘可回读、重名与保留名返回 `exists`、非法名字返回 `invalid`；port 构造之后由 `CreateAgent` 加入的成员按 profile 引用现读、可直接 `@` 拉起；主提示词 `multi-agent-mode` 激活时 `Agent` / `Task` 同样缺席、其他主提示词不影响派生工具；`CreateAgent` 带 `color` / `permissionMode` 落盘可回读、缺省时向后兼容。
- `apps/zcode-cli/packages/core/test/collaborationToolExposure.test.ts`：`SendMessage` 与 `CreateAgent` 常驻可见——`alwaysLoad: true`、不再声明 `shouldDefer`、`isDeferredTool` 判定为 false。
- `packages/ui/test/groupChatMembers.test.ts`：名册只收 `kind === "team"`、剔除 `enabled === false`、顺序 = 存储顺序、`idle` 且无 `childSessionId`（因此不可点）、连续派单取最新 `startedAt`、名字归一化与 name 优先于 id；真实 DOM：面板渲染头像 + 名字 + 简介 + 状态词、无 `childSessionId` 的成员不是 `<button>`、折叠态不渲染简介且保留展开入口。
- `packages/ui/test/groupChatMemberSourceWiring.test.ts`：会话面从 `useSubagents` 取成员（不直读恒空的 `useSubagentsStore.agents`）、名册与群聊上下文共用同一来源、回复卡在「成员已派单但还没文字」时也立卡、`SendMessage` 派单的裸 `subagent` 行也挂回复卡并带 `emptyFallback` 降级。
- 手工验证：设置页改开关后新建会话生效、旧会话不受影响；团队里 `@` 一个未运行的成员能看到它被拉起；把上限调到 1 后第二次 `@` 失败并提示上限；多智能体会话里每个成员消息与回复卡都带头像 + 名字 + 简介，右侧成员面板列出全部成员且点击可打开成员会话；`@` 一个成员后回复卡在它产出第一段文字前就出现（页脚「正在干活」），产出后正文替换为回复、引用条是用户原话（箭头与引文同一行）；把窗口拉窄到面板消失后消息卡的身份行仍在。
