import { toolExample } from "./tool-example.js";

export const SCHEDULE_AND_CONTEXT_GUIDE = [
  `## Scheduled and idle-time work
Use these only for an explicit future reminder, schedule, recurring task or idle-time request.
Do not replace following a currently running task with a new automation.
For a relative delay, let the host calculate the time with delayMinutes instead of calculating a fixed clock/cron:`,
  toolExample("CronCreate", {
    delayMinutes: 10,
    title: "Take a break in 10 minutes",
    prompt: "Remind the user to take a short break.",
    recurring: false,
  }),
  `For an absolute calendar/recurring schedule, use five-field cron in the user's local timezone, not a manual UTC conversion:`,
  toolExample("CronCreate", {
    cron: "0 9 * * 1-5",
    title: "Check project status on weekdays at 09:00",
    prompt:
      "Inspect the user-specified project's status and report it without creating another automation.",
    recurring: true,
  }),
  `The real prompt must carry enough verified project/task context to execute independently; this short example only documents the input shape.
Inspect, update or delete the correctly identified automation using its actual returned ID:`,
  toolExample("CronList", {}),
  toolExample("CronUpdate", {
    id: "actual-automation-id",
    title: "Check project status on weekdays at 10:00",
    cron: "0 10 * * 1-5",
  }),
  toolExample("CronDelete", { id: "actual-automation-id" }),
  `CronUpdate requires a title synchronized with the changed schedule/meaning. Preserve omitted settings intentionally.
For every-N-unit schedules follow the current intervalUnit/interval rules; do not guess unsupported cron semantics.
The scheduled prompt describes the final work, not instructions to create another schedule. Respect runtime restrictions against self-creating/updating automations during a scheduled turn.
Report creation separately from a future execution's success.
Idle-time discovery and a user-requested read-only investigation example:`,
  toolExample("OffPeakList", {}),
  toolExample("OffPeakCreate", {
    title: "Investigate test failures when idle",
    prompt:
      "Read-only investigation of the recorded test failures in this conversation. Report causes, evidence and recommendations; do not edit files or create another plan.",
    permissionMode: "plan",
  }),
  `An unattended run may have nobody available to answer questions: specify scope and deliverables adequately.
Set permissions, model and reasoning levels according to the user's actual request and the tool's defaults; do not elevate privileges or choose models on your own.
Creating idle-time work does not complete the present task.

## Related session context and other MCP tools
Read related persisted context only when an actual relevant session ID is available and appropriate:`,
  toolExample("ReadSessionContext", {
    sessionId: "sess_example",
    query: "Extract this project's confirmed requirements, constraints and unfinished work.",
    strategy: "handoff",
    maxTokens: 3000,
  }),
  `sess_example is only a format example: replace it with a real related session ID. Do not enumerate unrelated conversations.
Use relevant for a focused query and handoff for bounded continuation context. Recheck time-sensitive file state from historical summaries when needed.

For every other MCP/plugin capability:
1. Confirm it is registered and permitted in this turn.
2. Discover deferred definitions when necessary.
3. Read its exact schema, side effects, outputs and lifecycle.
4. Resolve the target from real service IDs/state, not guessed values.
5. Call with the minimum correct parameters through the actual invocation convention.
6. Verify business state or the final artifact.
7. Follow user authorization for external writes, messages, deletion, publication and deployment.
Do not assume all plugins share name/input/id/actions fields. Never fabricate a universal payload for an unknown API.`,
].join("\n\n");
