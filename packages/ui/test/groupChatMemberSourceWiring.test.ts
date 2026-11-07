import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * 群聊成员身份的「数据源」接线护栏。
 *
 * 只钉一件在渲染测试里做不到的事：会话面到底从哪份状态取成员。
 * 曾经的实际缺陷是——SessionPane 直读 useSubagentsStore.agents，而那个 store 在
 * Web 运行路径上没有任何 initialize 调用者，agents 恒为空，于是成员名册为空、
 * SendMessage 与回复卡都解析不到成员，界面只剩普通工具卡和一行状态文本；
 * 表现像样式问题，根因是数据源接错。整棵 SessionPane 需要 workspace 服务通道，
 * 这里按 botGroupConversationWiring.test.ts 的做法用结构断言，不假装渲染它。
 *
 * 运行：cd packages/ui && node --import tsx --test test/groupChatMemberSourceWiring.test.ts
 */

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(join(packageRoot, relativePath), "utf8");
}

test("成员身份取 useSubagents 统一入口，不直读 legacy useSubagentsStore", () => {
  const source = readSource("src/v4/SessionPane.tsx");
  assert.ok(
    source.includes("useSubagents("),
    "SessionPane 必须经 useSubagents 取子智能体（按 workspace 桶预加载）",
  );
  assert.ok(
    source.includes('from "@/hooks/useSubagents.js"'),
    "useSubagents 必须来自 hooks 公开入口",
  );
  assert.ok(
    !source.includes("useSubagentsStore("),
    "SessionPane 不得再订阅 useSubagentsStore：该 store 在 Web 运行路径上无人初始化，agents 恒为空",
  );
  assert.ok(
    source.includes("const { agents: subagentsForGroupChat } = useSubagents("),
    "成员名册与群聊上下文必须共用同一个 agents 来源",
  );
  assert.ok(
    source.includes("agents: subagentsForGroupChat"),
    "名册必须由该 agents 来源合成，避免出现第二份成员身份",
  );
});

test("回复卡在成员已派单但还没有文字时也立卡", () => {
  const reply = readSource("src/v4/ConversationAgentReply.tsx");
  assert.ok(
    reply.includes("running?: boolean"),
    "ConversationAgentReply 必须接收运行态，才能区分「还没说话」与「已结束」",
  );
  assert.ok(
    !reply.includes("if (!reply) return null;"),
    "只看 reply 文本会吞掉整张成员回复卡；必须保留 running 分支",
  );
  assert.ok(
    reply.includes("if (!reply && !(member && running)) return emptyFallback ?? null;"),
    "渲染判据必须是 reply 或（成员 + 运行中）之一，缺席时交回调用方的降级内容",
  );
  // 群聊里「正在干活」由运行态或流式任一成立即可，否则立的卡会没有任何进行中信号。
  assert.ok(
    reply.includes("const working = running || reply?.streaming === true;"),
    "footer 的进行中判据必须合并运行态与流式状态",
  );
  const row = readSource("src/v4/ConversationAgentToolCallRow.tsx");
  assert.ok(
    row.includes('running={item.subagentRow.status === "running"}'),
    "调用方必须把子会话运行态传给回复卡",
  );
});

test("SendMessage 派单没有 Agent/Task 工具行，回复卡必须挂在裸 subagent 行上", () => {
  // 群聊里的派单走 SendMessage：协议只产出 kind:"subagent" 行，没有 Agent/Task 工具调用，
  // 所以 ConversationAgentToolCallRow 那条路径在真实流程里永远不触发。回复卡若只在那里挂载，
  // 用户就只能看到一行 muted 摘要（或什么都没有）。
  const view = readSource("src/v4/ConversationRowView.tsx");
  assert.ok(
    view.includes("function SubagentRowView({") &&
      view.includes("context: ConversationRowRenderContext"),
    "SubagentRowView 必须接收会话行上下文，否则拿不到群聊成员与触发消息",
  );
  assert.ok(
    view.includes("const member = context.groupChatActive") &&
      view.includes("resolveGroupChatMemberByName(row.subagentType, context.groupChatMembers)"),
    "成员只在群聊模式下解析：普通子智能体行不得被说成团队成员",
  );
  assert.ok(
    view.includes("<ConversationAgentReply"),
    "成员行必须真正渲染回复卡，而不是继续输出一行摘要",
  );
  assert.ok(
    view.includes("emptyFallback={mutedSummary}"),
    "拿不到回复文本时要降级成原来的一行摘要，不能留空白",
  );
  assert.ok(
    view.includes('case "subagent":') && view.includes("context={context}"),
    "行分发必须把上下文透传给 subagent 行",
  );
});
