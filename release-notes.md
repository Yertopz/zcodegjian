# 多智能体：让多个智能体互相 @ 协作

## 新增功能

- **多智能体（团队模式）**：设置 →「智能体」→「多智能体」可以打开团队模式，并设定两件事：智能体之间互相 `@` 的次数上限（1–32，默认 8）和「创建者」是谁（默认主智能体）。开关只对之后新建的会话生效，正在运行的会话保持原样。
- **团队里不再层层分包**：打开团队模式后，任何智能体都不再获得「派生新的子智能体」的能力，协作改为互相 `@`。想确认是否生效：团队会话里让模型报告可用的协作工具，只会看到「发消息」而不是「新建子智能体」。
- **互相 @ 有额度，并且看得见**：每次 `@` 都会消耗一次额度，收到消息的智能体在提示里能看到「本会话剩余 @ 次数：N（上限 M）」，发起方在工具结果里也能拿到剩余次数。额度用尽后仍然可以调用发消息，但会直接返回失败并说明上限是多少。
- **按名字拉起成员**：在主对话里 `@某个智能体` 时，如果它还没在运行，主智能体会把它拉起来并把这个任务交给它；名字对不上会明确失败并列出当前可用的成员，不会悄悄换成别的做法。
- **一个智能体能创建新智能体**：被指定为创建者的智能体（默认主智能体）可以现场创建新的成员，写好名称、说明和提示词后立即在本会话可用，不需要重启。其余成员没有这个能力；重名（含内置名称）不会被覆盖。

## 体验优化

- 设置页的「多智能体」区块独立成页内分区，改动即时保存，非法上限会当场提示而不会写入。
- 创建者下拉框只列出当前工作区可用的智能体，选中后立刻反映到新会话。

## 升级须知（行为变化）

- 打开团队模式后，主智能体和团队成员都失去「派生新的子智能体」的工具；关闭开关并新建会话即可恢复。
- 团队模式下互相 `@` 的上限改用你设置的值（不再是固定的 32 次）；未打开团队模式的会话保持原有行为。

## 已知限制

- 改动对已有会话不生效，需要新建会话。
- 成员之间的 `@` 只能发给当前正在运行的同伴；把某个成员从闲置状态拉起来是主智能体的职责。
- 界面里的 `@名称` 仍然只表达任务意图，是否真的 `@` 由主智能体判断；还没有「用户指定发言人」的群聊路由。

## 本版尚未验证

- 新增设置区块与创建者下拉框没有在真实桌面会话中逐项点击验证，只做了组件级结构与文案检查。
- 未用一个真实的多次 `@` 长会话把额度耗到 0；额度递减与耗尽后的提示由单元测试覆盖。
- 多个智能体并发互相 `@` 时的实际排队顺序没有在真实模型上调过。

---

# Multi-agent: agents that @ each other

## New features

- **Multi-agent (team mode)**: Settings → Agents → Multi-agent turns team mode on and sets two things: how many times agents may `@` each other (1–32, default 8) and who the "creator" is (the main agent by default). The switch applies to sessions created afterwards; running sessions keep their current behavior.
- **No nested sub-agents in a team**: with team mode on, no agent gets the "spawn a new sub-agent" ability any more; collaboration happens by `@`-mentioning each other. To check: ask the model in a team session which collaboration tools it has — it sees "send message", not "spawn sub-agent".
- **`@` mentions are limited, and the count is visible**: every mention spends one credit; the receiving agent's prompt shows "Mentions remaining in this session: N (limit M)", and the sender gets the remaining count back in the tool result. When the credits run out, sending is still callable but fails with the limit quoted.
- **Members are launched by name**: when you `@some-agent` in the main conversation and it is not running yet, the main agent starts it and hands it the task. An unknown name fails clearly and lists the available members instead of quietly doing something else.
- **One agent can create agents**: the designated creator (the main agent by default) can create new members on the spot — give it a name, description and prompt and it is usable in this session without a restart. Other members do not have this ability, and duplicate names (including built-in ones) are never overwritten.

## UX improvements

- The Multi-agent block is its own settings section; changes save immediately and an invalid limit is reported instead of being written.
- The creator picker lists only the agents available in the current workspace, and a change shows up in new sessions right away.

## Upgrade notes (behavior changes)

- With team mode on, both the main agent and team members lose the "spawn a new sub-agent" tool; turn the switch off and create a new session to restore it.
- In team mode the mutual `@` limit comes from your setting (no longer the fixed 32); sessions without team mode behave as before.

## Known limitations

- Changes do not apply to existing sessions; create a new session.
- Members can only `@` peers that are currently running; starting an idle member is the main agent's job.
- An `@name` in the UI still only expresses task intent — whether to mention anyone is the main agent's decision. There is no user-driven speaker routing yet.

## Not verified in this release

- The new settings block and creator picker were not clicked through in a real desktop session; only component-level structure and copy were checked.
- A long real session that actually exhausts the mention limit was not run; decrementing and the exhausted-limit message are covered by unit tests.
- The real ordering of several agents mentioning each other concurrently was not exercised against live models.
