import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentsService } from "../src/subagents/subagentsService.js";

/**
 * 「多智能体」设置在服务层的读写往返。
 *
 * 为什么在这一层测：`ISubagentsService.getMultiAgentConfig/setMultiAgentConfig` 是设置页与 CLI
 * 之外唯一的读写入口，`~/.zcode/v2/agents-state.json` 是这条链的状态所有者。三个必须钉住的语义：
 * ① 缺省 = 未开启，读取不抛错（旧状态文件必须能被无痛读取）；
 * ② 局部补丁不覆盖另一个字段（设置页的开关与上限分两次写）；
 * ③ 越界值在写盘前被拒绝，磁盘内容原样保留 —— 不能让一次误操作把上限写成 0。
 *
 * 运行：cd packages/services && node --import tsx --test test/subagentsMultiAgentConfig.test.ts
 */

function createSandboxHome() {
  const home = mkdtempSync(join(tmpdir(), "zcode-multi-agent-"));
  const stateFile = join(home, ".zcode", "v2", "agents-state.json");
  mkdirSync(join(home, ".zcode", "v2"), { recursive: true });
  return { home, stateFile };
}

function readState(stateFile: string): Record<string, unknown> {
  return JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
}

test("空存储读出默认设置：未开启、默认上限、主智能体创建", async () => {
  const { home, stateFile } = createSandboxHome();
  try {
    const service = createSubagentsService({ homeDir: home });
    const settings = await service.getMultiAgentConfig();
    assert.deepEqual(settings, { enabled: false, mentionLimit: 8, creatorAgentId: "main" });
    // 读不写盘：仅打开设置页不应产生状态文件。
    assert.throws(() => readState(stateFile));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("开启后落盘，且局部补丁不覆盖另一个字段", async () => {
  const { home, stateFile } = createSandboxHome();
  try {
    const service = createSubagentsService({ homeDir: home });
    assert.equal((await service.setMultiAgentConfig({ patch: { enabled: true } })).enabled, true);

    const afterEnable = readState(stateFile).multiAgent as Record<string, unknown>;
    assert.equal(afterEnable.enabled, true);
    assert.equal(afterEnable.mentionLimit, 8);

    const updated = await service.setMultiAgentConfig({ patch: { mentionLimit: 3 } });
    assert.deepEqual(updated, { enabled: true, mentionLimit: 3, creatorAgentId: "main" });
    const afterLimit = readState(stateFile).multiAgent as Record<string, unknown>;
    assert.equal(afterLimit.enabled, true, "改上限不能把开关重置成关闭");
    assert.equal(afterLimit.mentionLimit, 3);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("写入保留状态文件里的其它字段（禁用列表、模型覆盖）", async () => {
  const { home, stateFile } = createSandboxHome();
  try {
    writeFileSync(
      stateFile,
      JSON.stringify({
        disabledAgentIds: ["user:demo"],
        builtInModelSelectionOverrides: {},
        pluginAgentModelSelectionOverrides: {},
      }),
      "utf8",
    );
    const service = createSubagentsService({ homeDir: home });
    await service.setMultiAgentConfig({ patch: { enabled: true } });
    const state = readState(stateFile);
    assert.deepEqual(state.disabledAgentIds, ["user:demo"]);
    assert.deepEqual(state.builtInModelSelectionOverrides, {});
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("越界上限被拒绝，磁盘内容原样保留", async () => {
  const { home, stateFile } = createSandboxHome();
  try {
    const service = createSubagentsService({ homeDir: home });
    await service.setMultiAgentConfig({ patch: { enabled: true, mentionLimit: 5 } });
    const before = readFileSync(stateFile, "utf8");

    await assert.rejects(() => service.setMultiAgentConfig({ patch: { mentionLimit: 0 } }));
    await assert.rejects(() => service.setMultiAgentConfig({ patch: { mentionLimit: 33 } }));
    assert.equal(readFileSync(stateFile, "utf8"), before, "失败的写入不能改动状态文件");

    // 队列没被失败的写入卡死：后续合法写入仍能生效。
    const recovered = await service.setMultiAgentConfig({ patch: { mentionLimit: 16 } });
    assert.equal(recovered.mentionLimit, 16);
    assert.equal(recovered.enabled, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("状态文件里的坏 multiAgent 视为未设置，读取不抛错", async () => {
  const { home, stateFile } = createSandboxHome();
  try {
    writeFileSync(
      stateFile,
      JSON.stringify({
        disabledAgentIds: [],
        builtInModelSelectionOverrides: {},
        pluginAgentModelSelectionOverrides: {},
        multiAgent: { enabled: "yes", mentionLimit: 999 },
      }),
      "utf8",
    );
    const service = createSubagentsService({ homeDir: home });
    assert.deepEqual(await service.getMultiAgentConfig(), {
      enabled: false,
      mentionLimit: 8,
      creatorAgentId: "main",
    });
    // 之后的合法写入把坏值纠正回来。
    assert.equal((await service.setMultiAgentConfig({ patch: { enabled: true } })).enabled, true);
    const repaired = readState(stateFile).multiAgent as Record<string, unknown>;
    assert.equal(repaired.enabled, true);
    assert.equal(repaired.mentionLimit, 8);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("并发写开关与上限不会互相覆盖（写队列串行）", async () => {
  const { home } = createSandboxHome();
  try {
    const service = createSubagentsService({ homeDir: home });
    const [first, second] = await Promise.all([
      service.setMultiAgentConfig({ patch: { enabled: true } }),
      service.setMultiAgentConfig({ patch: { mentionLimit: 4 } }),
    ]);
    assert.equal(first.enabled, true);
    assert.equal(second.mentionLimit, 4);
    const final = await service.getMultiAgentConfig();
    assert.equal(final.enabled, true, "两次局部写入必须都落盘");
    assert.equal(final.mentionLimit, 4);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
