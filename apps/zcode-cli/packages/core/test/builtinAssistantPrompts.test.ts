import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { MAIN_ASSISTANT_PROMPT, IDE_ASSISTANT_PROMPT, composeIdePrompt } from "@zcode/shared";
import {
  CreateAgentInputSchema,
  CreateAgentInputJsonSchema,
  JsInputSchema,
  JsInputJsonSchema,
  ReadPdfInputJsonSchema,
  type JsonSchema,
} from "@zcode/contracts";
import { builtInTools } from "../src/tool/handlers/index.js";
import { validateJsonSchemaValue } from "../src/tool/json-schema.js";
import { ContextBuilder } from "../src/context/builder.js";
import { createSubagentContextBuilder } from "../src/subagent/context-builder.js";
import { isIdeToolAllowed } from "../src/runtime/helpers/ide-tool-policy.js";

const envInfo = {
  cwd: "/workspace/project",
  platform: "linux",
  shell: "bash",
  osVersion: "fixture",
  nodeVersion: "24",
};
const ideContext = {
  version: 1 as const,
  activeFile: { absolutePath: "/workspace/project/src/main.ts", hasUnsavedChanges: true },
};

function examplesFrom(prompt: string) {
  return [...prompt.matchAll(/^Tool: (\w+)\r?\nArguments: ([^\r\n]+)$/gm)].map((match) => ({
    name: match[1],
    input: JSON.parse(match[2]) as Record<string, unknown>,
  }));
}

function schemaFor(name: string, input: Record<string, unknown>) {
  if (name === "CreateAgent") {
    return { inputSchema: CreateAgentInputJsonSchema, runtimeInputSchema: CreateAgentInputSchema };
  }
  if (name === "mcp__node_repl__js") {
    return { inputSchema: JsInputJsonSchema, runtimeInputSchema: JsInputSchema };
  }
  const entry = builtInTools.find((tool) => tool.metadata.name === name);
  assert.ok(entry, `Example refers to an unregistered tool: ${name}`);
  // pages 只在支持 PDF 的 Read 投影中暴露，不能拿基础 Read 的 Schema 冒充这一分支。
  return {
    inputSchema: name === "Read" && "pages" in input ? ReadPdfInputJsonSchema : entry.inputSchema,
    runtimeInputSchema: entry.runtimeInputSchema,
  };
}

function assertExample(name: string, input: Record<string, unknown>) {
  const schemas = schemaFor(name, input);
  const modelValidation = validateJsonSchemaValue(input, schemas.inputSchema as JsonSchema);
  assert.equal(modelValidation.valid, true, `${name}: ${modelValidation.errors.join("; ")}`);
  const runtimeSchema = schemas.runtimeInputSchema;
  assert.ok(runtimeSchema, `${name} must have its real runtime input schema`);
  const runtimeValidation = runtimeSchema.safeParse(input);
  assert.equal(runtimeValidation.success, true, `${name}: ${JSON.stringify(runtimeValidation)}`);
  if (name === "DeferredToolCall") {
    assertExample(String(input.name), input.input as Record<string, unknown>);
  }
  if (name === "CreateWorkflow") {
    assert.equal(["path", "script", "saved"].filter((key) => key in input).length, 1);
  }
  if (name === "SaveWorkflow") {
    assert.equal(["script_path", "script"].filter((key) => key in input).length, 1);
  }
  if (name === "EvalWorkflowSnippet") {
    assert.equal(["path", "code"].filter((key) => key in input).length, 1);
  }
  if (name === "js" || name === "mcp__node_repl__js") {
    // 只解析示例代码，不能在契约测试里启动浏览器、执行命令或产生网络副作用。
    new Script(`(async () => { ${String(input.code)}\n })`);
  }
}

test("English built-in prompts include portable project, documentation and tool recovery rules", () => {
  for (const prompt of [MAIN_ASSISTANT_PROMPT, IDE_ASSISTANT_PROMPT]) {
    assert.doesNotMatch(prompt, /[\u3400-\u9fff]/u);
    assert.match(prompt, /AGENTS\.md/);
    assert.match(prompt, /Simplified Chinese/);
    assert.match(prompt, /specification/i);
    assert.match(prompt, /comments/i);
    assert.match(prompt, /stale/i);
    assert.doesNotMatch(prompt, /pnpm typecheck|architecture:check|F:\\zcode/);
  }
});

test("every tool example in the shipped prompt validates against actual model and runtime schemas", () => {
  const mainExamples = examplesFrom(MAIN_ASSISTANT_PROMPT);
  const names = new Set(mainExamples.map((example) => example.name));
  for (const name of [
    "Read",
    "Edit",
    "Write",
    "Bash",
    "Glob",
    "Grep",
    "TaskOutput",
    "TaskStop",
    "AskUserQuestion",
    "ToolSearch",
    "DeferredToolCall",
    "Skill",
    "TodoRead",
    "TodoWrite",
    "WebSearch",
    "WebFetch",
    "js",
    "mcp__node_repl__js",
    "Agent",
    "CreateAgent",
    "SendMessage",
    "RespondToCoordinator",
    "EnterPlanMode",
    "ExitPlanMode",
    "CreateWorkflow",
    "AmendWorkflow",
    "SaveWorkflow",
    "EvalWorkflowSnippet",
    "ListSavedWorkflows",
    "ListModels",
    "ListWorkflowRuns",
    "GetWorkflowRun",
    "ResumeWorkflowRun",
    "ResolveWorkflowQuestion",
    "submit_result",
    "escalate",
    "CronCreate",
    "CronList",
    "CronUpdate",
    "CronDelete",
    "OffPeakCreate",
    "OffPeakList",
    "ReadSessionContext",
  ])
    assert.ok(names.has(name), `Missing usage example for ${name}`);
  for (const example of [...mainExamples, ...examplesFrom(IDE_ASSISTANT_PROMPT)]) {
    assertExample(example.name, example.input);
  }
});

test("IDE examples use only the current allowed tools and retain unsaved snapshot guidance", () => {
  const examples = examplesFrom(IDE_ASSISTANT_PROMPT);
  assert.equal(new Set(examples.map((example) => example.name)).size, 9);
  for (const example of examples) {
    assert.equal(isIdeToolAllowed(ideContext, example.name), true, example.name);
  }
  const composed = composeIdePrompt(ideContext);
  assert.ok(composed.startsWith(IDE_ASSISTANT_PROMPT));
  assert.match(composed, /hasUnsavedChanges/);
  assert.match(composed, /buffer/i);
  assert.match(composed, /snapshot/i);
  assert.ok(composed.endsWith(JSON.stringify({ mode: "ide", activeFile: ideContext.activeFile })));
});

test("default main prompt is isolated from IDE, full custom prompts and child identities", () => {
  const build = (extra: Partial<ConstructorParameters<typeof ContextBuilder>[0]> = {}) =>
    new ContextBuilder({ workingDirectory: envInfo.cwd, envInfo, ...extra }).build();
  const content = (result: ReturnType<typeof build>) =>
    result.systemMessages.map((message) => message.content).join("\n");
  assert.ok(content(build()).includes(MAIN_ASSISTANT_PROMPT));
  assert.ok(
    content(build({ outputStyle: { name: "brief", prompt: "STYLE_MARKER" } })).includes(
      MAIN_ASSISTANT_PROMPT,
    ),
  );
  const selected = content(
    build({
      mainAgentPrompt: { id: "custom", name: "role", description: "", prompt: "ROLE_MARKER" },
    }),
  );
  assert.ok(selected.includes(MAIN_ASSISTANT_PROMPT));
  assert.ok(selected.indexOf("ROLE_MARKER") > selected.indexOf(MAIN_ASSISTANT_PROMPT));
  const ide = content(build({ ideContext }));
  assert.ok(ide.includes(IDE_ASSISTANT_PROMPT));
  assert.ok(!ide.includes(MAIN_ASSISTANT_PROMPT));
  assert.ok(
    !content(build({ customSystemPrompt: "CUSTOM_MARKER" })).includes(MAIN_ASSISTANT_PROMPT),
  );
  assert.ok(!content(build({ workflowActor: { name: "worker" } })).includes(MAIN_ASSISTANT_PROMPT));
  const child = createSubagentContextBuilder({ agentPrompt: "CHILD_MARKER", envInfo }).build();
  assert.ok(!content(child).includes(MAIN_ASSISTANT_PROMPT));
});
