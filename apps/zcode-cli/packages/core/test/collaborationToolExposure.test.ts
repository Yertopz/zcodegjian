import assert from "node:assert/strict";
import test from "node:test";
import { createCreateAgentToolEntry } from "../src/tool/handlers/create-agent.js";
import { sendMessageToolEntry } from "../src/tool/handlers/send-message.js";
import { isDeferredTool } from "../src/tool/search/exposure.js";
import type { ModelToolContract } from "@zcode/contracts";

/**
 * 多智能体的两个协作入口必须常驻工具列表。
 *
 * 为什么必须钉住：这两个工具曾声明 `shouldDefer`，于是模型只看到目录名、拿不到 schema，
 * 表现为反复输出「我现在向 X 发送…」却不真正调用 —— 成员从未启动，界面上只剩子智能体语义。
 * 它们不是「偶尔用一次的冷工具」，而是建队与分派的核心动作，必须始终出现在 provider 工具列表里。
 *
 * 运行：cd apps/zcode-cli/packages/core && node --import tsx --test test/collaborationToolExposure.test.ts
 */

function contract(name: string): ModelToolContract {
  return { name, description: name, inputSchema: { type: "object" } } as never;
}

test("SendMessage 与 CreateAgent 常驻可见，不会被 ToolSearch 延迟到目录里", () => {
  const createAgentEntry = createCreateAgentToolEntry({
    target: {
      agentsDir: "agents",
      enabledAgentNames: () => [],
      onCreated: () => {},
    },
  });

  for (const entry of [sendMessageToolEntry, createAgentEntry]) {
    assert.equal(entry.metadata?.alwaysLoad, true, `${entry.metadata?.name} 必须 alwaysLoad`);
    assert.notEqual(entry.metadata?.shouldDefer, true, `${entry.metadata?.name} 不得再声明 shouldDefer`);
    assert.equal(
      isDeferredTool(contract(entry.metadata?.name ?? ""), entry.metadata),
      false,
      `${entry.metadata?.name} 不能被判定为 deferred`,
    );
  }
});
