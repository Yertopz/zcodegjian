import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentsService } from "../src/subagents/subagentsService.js";

/**
 * 团队成员/子智能体头像在服务层的读写往返。
 *
 * 为什么在这一层测：头像是纯 UI 偏好，但它的状态所有者是 `~/.zcode/v2/agents-state.json`
 * （与启停、模型覆盖同层），而 `ISubagentsService.setAgentAvatar` 是唯一写入口。
 * 这里钉住四个容易回归的语义：
 * ① 头像随 `list()` 一起返回，写盘后重新读进程仍在；
 * ② `avatar: null` 删除键，而不是写入空对象；
 * ③ 改名换 id 时头像跟着迁移 —— 否则用户刚设的头像被一次改名静默抹掉；
 * ④ 删档清键 —— id 会被同名新建复用，残留头像会挂到不相干的新成员上。
 *
 * 运行：cd packages/services && node --import tsx --test test/subagentsAgentAvatar.test.ts
 */

const PROVIDER = "glm" as const;

function createSandbox() {
  const home = mkdtempSync(join(tmpdir(), "zcode-agent-avatar-"));
  const stateFile = join(home, ".zcode", "v2", "agents-state.json");
  const workspacePath = join(home, "workspace");
  mkdirSync(join(home, ".zcode", "v2"), { recursive: true });
  mkdirSync(workspacePath, { recursive: true });
  return { home, stateFile, workspacePath };
}

function readState(stateFile: string): Record<string, unknown> {
  return JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
}

function readAvatars(stateFile: string): Record<string, unknown> {
  return (readState(stateFile).agentAvatars ?? {}) as Record<string, unknown>;
}

async function createSandboxAgent(
  service: ReturnType<typeof createSubagentsService>,
  name: string,
) {
  const { agent } = await service.createAgent({
    provider: PROVIDER,
    config: {
      name,
      description: `${name} description`,
      systemPrompt: `${name} prompt`,
      kind: "team",
    },
  });
  return agent;
}

test("设置头像后 list 返回，重新读盘仍在", async () => {
  const { home, stateFile, workspacePath } = createSandbox();
  try {
    const service = createSubagentsService({ homeDir: home, isDesktopRuntime: true });
    const agent = await createSandboxAgent(service, "reviewer");
    await service.setAgentAvatar({
      agentId: agent.id,
      avatar: { kind: "emoji", value: "🦊" },
    });

    assert.deepEqual(readAvatars(stateFile)[agent.id], { kind: "emoji", value: "🦊" });

    // 换一个 service 实例（模拟重启）确认头像来自磁盘，而不是进程内缓存。
    const reopened = createSubagentsService({ homeDir: home, isDesktopRuntime: true });
    const list = await reopened.list({ workspacePath, mode: "settingsUserOnly" });
    const listed = list.agents.find((item) => item.id === agent.id);
    assert.deepEqual(listed?.avatar, { kind: "emoji", value: "🦊" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("avatar: null 删除键，而不是写入空值", async () => {
  const { home, stateFile, workspacePath } = createSandbox();
  try {
    const service = createSubagentsService({ homeDir: home, isDesktopRuntime: true });
    const agent = await createSandboxAgent(service, "writer");
    await service.setAgentAvatar({
      agentId: agent.id,
      avatar: { kind: "emoji", value: "✍️" },
    });
    await service.setAgentAvatar({ agentId: agent.id, avatar: null });

    assert.equal("avatar" in readAvatars(stateFile), false);
    const listed = (await service.list({ workspacePath, mode: "settingsUserOnly" })).agents.find(
      (item) => item.id === agent.id,
    );
    assert.equal(listed?.avatar, undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("改名换 id 时头像跟着迁移", async () => {
  const { home, stateFile, workspacePath } = createSandbox();
  try {
    const service = createSubagentsService({ homeDir: home, isDesktopRuntime: true });
    const agent = await createSandboxAgent(service, "scout");
    await service.setAgentAvatar({
      agentId: agent.id,
      avatar: { kind: "emoji", value: "🔭" },
    });

    const { agent: renamed } = await service.updateAgent({
      agentId: agent.id,
      provider: PROVIDER,
      oldFilePath: agent.path,
      config: {
        name: "scout-two",
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        kind: "team",
      },
    });

    assert.notEqual(renamed.id, agent.id, "改名必须产生新 id，否则该用例测不到迁移");
    const avatars = readAvatars(stateFile);
    assert.equal(agent.id in avatars, false, "旧 id 的键要清掉，否则成为永久孤儿");
    assert.deepEqual(avatars[renamed.id], { kind: "emoji", value: "🔭" });

    const listed = (await service.list({ workspacePath, mode: "settingsUserOnly" })).agents.find(
      (item) => item.id === renamed.id,
    );
    assert.deepEqual(listed?.avatar, { kind: "emoji", value: "🔭" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("删档时清掉头像键", async () => {
  const { home, stateFile } = createSandbox();
  try {
    const service = createSubagentsService({ homeDir: home, isDesktopRuntime: true });
    const agent = await createSandboxAgent(service, "helper");
    await service.setAgentAvatar({
      agentId: agent.id,
      avatar: { kind: "emoji", value: "🧰" },
    });

    await service.deleteAgent({ agentId: agent.id, filePath: agent.path });
    assert.equal(agent.id in readAvatars(stateFile), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("状态文件里的坏头像按未设置处理，写入不破坏其它字段", async () => {
  const { home, stateFile } = createSandbox();
  try {
    writeFileSync(
      stateFile,
      JSON.stringify({
        disabledAgentIds: ["user:demo"],
        builtInModelSelectionOverrides: {},
        pluginAgentModelSelectionOverrides: {},
        agentAvatars: {
          "user:bad-kind": { kind: "video", value: "x" },
          "user:too-long": { kind: "emoji", value: "🦊".repeat(20) },
          "user:good": { kind: "emoji", value: "🦊" },
        },
      }),
      "utf8",
    );
    const service = createSubagentsService({ homeDir: home, isDesktopRuntime: true });
    await service.setAgentAvatar({
      agentId: "user:added",
      avatar: { kind: "emoji", value: "🎯" },
    });

    const avatars = readAvatars(stateFile);
    assert.equal("user:bad-kind" in avatars, false, "读盘时就要丢掉非法 kind");
    assert.equal("user:too-long" in avatars, false, "读盘时就要丢掉超长值");
    assert.deepEqual(avatars["user:good"], { kind: "emoji", value: "🦊" });
    assert.deepEqual(avatars["user:added"], { kind: "emoji", value: "🎯" });
    assert.deepEqual(readState(stateFile).disabledAgentIds, ["user:demo"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
