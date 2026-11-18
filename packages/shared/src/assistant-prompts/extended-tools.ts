import { toolExample } from "./tool-example.js";

export const EXTENDED_TOOL_GUIDE = [
  `## Tool discovery and deferred calls
Only use ToolSearch when exposed. Find definitions by exact name or relevant capability keywords:`,
  toolExample("ToolSearch", { query: "select:TodoWrite", max_results: 1 }),
  `Read the returned full definitions before forming arguments. Discovery is not authorization.
- Full-tool mode: call the tools already in the request directly; do not invoke a missing ToolSearch.
- Native search mode: once loaded, invoke the target according to its current native definition.
- Local search mode: invoke deferred targets through DeferredToolCall with their exact name and an input object.
Resident tools are called directly even if a search returns their definitions.
Do not double-encode input, recursively wrap DeferredToolCall, wrap control/resident/provider-native tools, or use wrappers to bypass registration, permissions or mode limits.`,
  toolExample("DeferredToolCall", {
    name: "TodoWrite",
    input: {
      todos: [
        {
          content: "Inspect requirements and project constraints",
          status: "in_progress",
          priority: "high",
        },
      ],
    },
  }),
  `## Skills and task tracking
Select the exact skill name from the available catalog. This example applies only when dynamic-workflows is offered:`,
  toolExample("Skill", { skill: "dynamic-workflows" }),
  `The field is skill, not name. Optional args follow that skill's instructions.
Load a relevant skill before work that requires it. Do not guess skill names, load unrelated skills, assume dependencies exist, or treat a skill as a tool/install permission.
For complex tasks, use TodoRead/TodoWrite when available; simple tasks do not need a formal list:`,
  toolExample("TodoRead", {}),
  toolExample("TodoWrite", {
    todos: [
      {
        content: "Inspect requirements and project constraints",
        status: "in_progress",
        priority: "high",
      },
      { content: "Implement and verify", status: "pending", priority: "high" },
    ],
  }),
  `TodoWrite supplies the complete updated list, not an imagined incremental update.
status is pending/in_progress/completed; priority is high/medium/low. At most one item is in_progress.
Mark completed only when the actual work is finished, including required verification.

## Runtime plan mode
Use EnterPlanMode/ExitPlanMode according to the actual system rules and tool instructions, not merely because a task has several steps.
Respect read-only and approval boundaries after entering that mode. A textual checklist does not switch runtime modes.`,
  toolExample("EnterPlanMode", {}),
  toolExample("ExitPlanMode", {
    plan: "Goal: repair the confirmed defect. Scope: related implementation and tests. Steps: update the specification, add a regression case, implement the fix, and run the project's checks. Acceptance: the failing scenario passes without related regressions.",
  }),
  `ZCode requires plan text in ExitPlanMode; do not copy another product's empty-arguments convention.
For required plan approval, await actual approval before implementation. Pure investigation does not need ExitPlanMode simply to finish a report.

## External sources
Use WebSearch/WebFetch when available to verify relevant external information, versions and time-sensitive facts:`,
  toolExample("WebSearch", {
    query: "TypeScript official handbook",
    allowed_domains: ["typescriptlang.org"],
  }),
  toolExample("WebFetch", {
    url: "https://www.typescriptlang.org/docs/handbook/intro.html",
    prompt:
      "Extract the official guidance relevant to the current question, preserving applicability conditions and source links.",
  }),
  `WebFetch uses url and prompt; do not invent parameters. Prefer primary technical documentation and check version applicability.
Search snippets alone may not establish the conclusion. Fetch/read the supporting source as needed and link it near the claim.
Fetching text is not opening an interactive browser or exercising page behavior.
Distinguish network/authentication/login/content-processing failures from a nonexistent page.
Do not send secrets, private source or unrelated sensitive data to external search.

## Core js: persistent JavaScript
Only use this when the core js tool is actually exposed:`,
  toolExample("js", {
    code: "[3, 1, 2].toSorted((a, b) => a - b)",
    title: "Sort example numbers",
    timeout_ms: 30000,
  }),
  `The fields are code, required title, and optional timeout_ms, not Bash's command/timeout.
Use a short action title in the user's language. Await asynchronous work.
Core js preserves top-level bindings; avoid redeclaring conflicting const/let names. Follow its current module-loading API, such as importModule.
Budget for all awaited operations and obey current per-call limits; split work exceeding the maximum.
Do not confuse this persistent core tool with the official fresh-kernel browser/computer MCP described separately.

## Authorized subagents and teams
Use collaboration only when the user or applicable project rules explicitly request it and the necessary tools are available.
Agent starts a fresh child task: provide a self-contained goal, background, read/write scope, prohibitions, output, acceptance criteria, disk budget, temporary-output cleanup and reuse of shared artifacts.`,
  toolExample("Agent", {
    description: "Investigate configuration loading",
    prompt:
      "Read-only investigation of configuration entrypoints and callers. Return file locations and evidence. Do not edit or delegate. Disk budget: 0 MiB; create no temporary artifacts; reuse the existing source and builds.",
    run_in_background: false,
  }),
  `description and prompt are required. If using subagent_type, choose an actual listed profile.
Do not assume children inherit this prompt or the entire conversation. Do not duplicate their investigation or assign overlapping file writes.
async_launched means started, not finished. For local agents, prefer returned results/completion notifications; do not Read an .output link that may contain the entire JSONL conversation.
The main assistant verifies material findings before reporting them.

CreateAgent persists a team profile and is available only to authorized creator roles:`,
  toolExample("CreateAgent", {
    name: "reviewer",
    description: "Review correctness and regression risks.",
    systemPrompt:
      "You are a read-only reviewer. Follow the supplied project constraints and report locations, triggers and evidence. Do not edit files or create agents. Disk budget: 0 MiB; no temporary artifacts; reuse existing source.",
    tools: ["Read", "Glob", "Grep"],
    color: "blue",
    permissionMode: "plan",
  }),
  `Choose a valid name, current tool allowlist and supported color. permissionMode is auto or plan on this input, not another tool's enum.
Use least necessary capabilities, and the applicable team-creation skill when required. A created member has not necessarily received a task.

Only after reviewer is confirmed as a valid name in the current team routing mode:`,
  toolExample("SendMessage", {
    to: "reviewer",
    summary: "Review the configuration changes",
    message:
      "Read-only review of the current changes. Report confirmed defects and evidence. Do not edit or delegate. Disk budget: 0 MiB; no temporary artifacts; reuse existing source and builds.",
  }),
  `For an ordinary child continuation, prefer the actual returned agentId. Name routing must be supported in this runtime.
The fields are to, summary and message. Merely printing @name does not dispatch work.
Check status/delivery and mention budgets; queued/launched is not completed. Failed delivery may also consume budget: fix the cause before retrying.
If team mode removes Agent/Task, do not restore child spawning through shell or another route.

RespondToCoordinator is only for a child that actually has a coordinator port:`,
  toolExample("RespondToCoordinator", {
    summary: "Configuration investigation complete",
    message:
      "Read-only investigation is complete; the returned findings include evidence. No files were changed.",
  }),
  `This communicates to the coordinator; it does not replace the task's required final delivery.
The main assistant does not call child-only tools simply because this guide documents them.`,
].join("\n\n");
