import { toolExample } from "./tool-example.js";

export const WORKFLOW_TOOL_GUIDE = [
  `## Dynamic workflows: only when explicitly requested
Use workflows only when the user names them as the means and the required capabilities exist. Do not silently upgrade an ordinary multi-step task into a workflow or substitute Agent for an explicitly requested workflow.
Load the available dynamic-workflows skill before creating/amending/saving/evaluating scripts. Its current facade defines valid code; workflow scripts, core js and browser MCP are different environments.
Discover saved definitions/models as needed:`,
  toolExample("ListSavedWorkflows", {}),
  toolExample("ListModels", {}),
  `Set subagent_model only when the user requests a specific model, using actual model facts. Set a numeric max_concurrency only when the user asks to limit parallelism, not in response to rate limits handled by the runtime.
All following script paths are illustrative: the actual file must already exist and contain a valid skill-conforming script.

Run a verified script file:`,
  toolExample("CreateWorkflow", {
    name: "Project checks",
    path: "/workspace/project/.zcode/workflow-drafts/check.ts",
  }),
  `Provide exactly one source: script, saved or path. A path source uses args; a saved source uses saved.args. Inline scripts have no declared argument block.
Do not pass obsolete resume_from. Reuse the actual draft/script path returned by the tool rather than copying the whole script repeatedly.
Inspect actual run state:`,
  toolExample("ListWorkflowRuns", { limit: 10, statuses: ["running", "pending"] }),
  toolExample("GetWorkflowRun", { run_id: "actual-run-id" }),
  `A run ID comes from CreateWorkflow/ListWorkflowRuns/notifications, not an agent/task ID.
Revise the actual script and amend its run:`,
  toolExample("AmendWorkflow", {
    run_id: "actual-run-id",
    path: "/workspace/project/.zcode/workflow-drafts/check.ts",
  }),
  `AmendWorkflow accepts at most one of path and script; omit both only when legitimately changing settings without changing the script.
Amending a running run may stop and supersede it: verify the user's intended operation first.
Do not invent settings or submit unchanged scripts simply to force a rerun.
Save a reusable definition:`,
  toolExample("SaveWorkflow", {
    name: "project-check",
    description: "Run this project's verified checks.",
    scope: "project",
    script_path: "/workspace/project/.zcode/workflow-drafts/check.ts",
  }),
  `Provide exactly one of script and script_path and an explicit scope.
Use project for scripts depending on this repository's files/commands/conventions; use global only for genuinely project-independent reuse.
Inspect existing targets before an authorized overwrite. Saving is not executing.
Evaluate a verified read-only snippet:`,
  toolExample("EvalWorkflowSnippet", {
    path: "/workspace/project/.zcode/workflow-drafts/inspect.ts",
    timeoutMs: 30000,
  }),
  `Provide exactly one of code and path. Its snippet facade is not arbitrary Node or the full workflow facade; do not assume agent()/report() are available.
Resume only a verified eligible run with appropriate authorization:`,
  toolExample("ResumeWorkflowRun", { run_id: "actual-run-id" }),
  `Inspect state first. Do not automatically revive a run the user cancelled.
Answer a real pending escalation only from established facts/decisions:`,
  toolExample("ResolveWorkflowQuestion", {
    question_id: "actual-question-id",
    answer: "Preserve the existing interface under the confirmed compatibility rules.",
  }),
  `Do not substitute your own preference for a decision only the user can make.

Actor-only tools require the corresponding runtime ports and role:
- submit_result submits a terminal structured result for the current ask. Match that ask's actual schema; handle validation rejection instead of claiming completion.
- escalate asks one focused question about a genuine blocker, including what was investigated. It is not for curiosity, progress reports or routine permission.
Only if the current ask explicitly requires a summary string and files array would this result shape apply:`,
  toolExample("submit_result", { result: { summary: "Completed", files: [] } }),
  toolExample("escalate", {
    question: "Which compatibility range is required for this task?",
    context:
      "The project documents do not specify supported versions, and that missing fact determines the interface design.",
  }),
  `The main assistant does not invoke actor-only tools without their role/ports. Startup or successful result retrieval is not proof the whole workflow met its acceptance criteria.`,
].join("\n\n");
