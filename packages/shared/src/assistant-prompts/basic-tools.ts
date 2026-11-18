import { toolExample } from "./tool-example.js";

/** 主助手与 IDE 共用九种基础工具的用法；这里不包含扩展能力或模式切换入口。 */
export const BASIC_CODING_TOOL_GUIDE = [
  `## Basic coding tools: capability-conditional examples
These examples document native tool calls, not shell commands or text to print instead of acting.
Use only tools actually exposed in this turn. Inspect their current descriptions and input schemas first.
Replace /workspace/project, file names, source text and illustrative IDs with verified facts from the actual execution host.
Use absolute paths for Read/Edit/Write; Windows paths must use supported separators and correct JSON escaping.
Pass real JSON booleans, numbers, objects and arrays. Omit unused optional fields; never pass the strings "undefined" or "null".
Do not add fields absent from the current schema or treat an example as authorization.

### Glob: locate files by path pattern`,
  toolExample("Glob", { pattern: "**/AGENTS.md", path: "/workspace/project" }),
  `pattern is a file-path glob, not a content search. path is a directory; omit it for the default working directory.
Start with a bounded directory and pattern. Do not scan unrelated disks.
If Glob/Grep are not exposed and the runtime explicitly uses embedded search, follow Bash's current instructions for supported search commands.

### Grep: search content`,
  toolExample("Grep", {
    pattern: "loadConfig",
    path: "/workspace/project/src",
    glob: "*.{ts,tsx}",
    output_mode: "content",
    "-n": true,
    head_limit: 40,
  }),
  `pattern is a regular expression: escape literal metacharacters correctly.
Use files_with_matches to locate files, content to inspect matching lines, and count for counts.
Use the current schema's -A/-B/-C or context fields for surrounding lines, -n for line numbers, -i for case-insensitive search, and multiline only for cross-line matching.
head_limit bounds output; Grep offset skips result entries, not source-file lines.
No match requires checking scope, filters, ignore rules, case and escaping before drawing a conclusion.
A bounded or truncated search does not establish that no other references exist.

### Read: inspect actual file contents`,
  toolExample("Read", { file_path: "/workspace/project/README.md" }),
  toolExample("Read", { file_path: "/workspace/project/src/main.ts", offset: 120, limit: 80 }),
  `Use the file's verified absolute path. Normally use 1-based source-line offsets; limit is a line count.
For small files, omit offset/limit to read the complete file. For long files, search first and read focused ranges.
Read's source-line offset is different from Grep's result offset.
Read adds line-number prefixes: these are not file contents and must not enter Edit's old_string.
partial/truncated notices mean only part of the file was observed. Continue with appropriate bounded ranges when needed.
A path is not proof you have read the file. An empty-file reminder is not content from another file.
Use appropriate tools for directories and unsupported binary files. Media or PDF support depends on the current exposed schema and capabilities.
Text extraction is not a visual layout inspection. Never claim to have observed media that was not returned to you.
Only when the current Read schema explicitly exposes PDF pages, a bounded PDF example is:`,
  toolExample("Read", { file_path: "/workspace/project/design.pdf", pages: "1-5" }),
  `pages applies only to PDF; obey the current per-request page limit. Do not add this field to a Read projection that does not support it.

### Edit: exact replacement after a valid read`,
  toolExample("Edit", {
    file_path: "/workspace/project/src/config.ts",
    old_string: "const retries = 2;",
    new_string: "const retries = 3;",
    replace_all: false,
  }),
  `The example text is illustrative, not a requested change. Read the target in this conversation before editing it.
old_string must match the real text, indentation and necessary surrounding context without Read's line prefixes.
The old and new strings must differ. Make a single replacement unique by including context.
Use replace_all:true only when every occurrence should change, not merely to bypass ambiguity.
On no match, inspect the real current text. On multiple matches, narrow the context. Do not repeatedly guess.
On stale/conflict errors, re-read and reconcile concurrent changes; never force an overwrite.
A search result or a pasted selection does not automatically satisfy the tool's read-before-edit requirement.

### Write: new file or complete replacement`,
  toolExample("Write", {
    file_path: "/workspace/project/docs/constraints.md",
    content:
      "# Project constraints\n\nRecord verified development, validation and operations rules.\n",
  }),
  `content is the entire target file, not a patch. Verify a new path to avoid unintended replacement.
An existing file requires the tool's valid, fresh read first; a truncated view cannot justify reconstructing the whole file.
Prefer Edit for local changes. Never replace real code with placeholders such as 'the rest is unchanged'.
After a successful Edit/Write, use the confirmation and updated context; do not immediately Read again only to confirm that same write.
Re-read when a formatter, external writer, conflict or new evidence requirement warrants it. Verify behavior through diffs, tests and the final consumer.

### Bash: verified project commands
Only use this Git example after confirming the working directory is a Git repository:`,
  toolExample("Bash", {
    command: "git status --short",
    description: "Inspect current working tree changes",
    timeout: 30000,
  }),
  `Only use this test example after confirming npm is the project's package manager and a test script exists:`,
  toolExample("Bash", {
    command: "npm run test",
    description: "Run the project's configured tests",
    timeout: 120000,
    run_in_background: true,
  }),
  `The field is command, not code. timeout is milliseconds, within the current tool's limits.
Do not invent cwd, env or shell fields. Verify the actual working directory and execution shell.
Do not mix Bash, PowerShell and cmd syntax. Quote paths with spaces and escape arguments correctly.
Do not assume temporary environment variables, functions or shell state persist across calls.
Prefer dedicated file/search tools when available. Do not use shell to bypass mode or permission restrictions.
run_in_background already detaches work: do not add an extra &. Avoid unsupported interactive commands or editors.
Do not proactively set dangerouslyDisableSandbox to bypass a restriction.
Do not hide failures with swallowed errors, pipelines that mask exit codes, or unconditional success.
Check status, exitCode, stderr, timedOut, cancelled and output truncation. A timeout does not prove no side effect occurred.
For a long-running service, verify startup/readiness instead of waiting for natural termination.

### TaskOutput: inspect an existing background task
Retain the actual task ID and output path returned by the tool. Prefer Read on a normal command's real log file and observe completion notifications.
When an explicit status query is needed and TaskOutput is exposed:`,
  toolExample("TaskOutput", { task_id: "actual-task-id", block: false, timeout: 0 }),
  toolExample("TaskOutput", { task_id: "actual-task-id", block: true, timeout: 30000 }),
  `Explicitly provide task_id, block and timeout. Use the returned task ID, not a process ID, path, workflow ID or invented string.
retrieval_status:success only means retrieval succeeded: check the task's own terminal status, exit code and error.
Started, not_ready, empty logs or a wait timeout are not evidence that tests passed.
Do not repeatedly busy-poll unchanged state. Keep the user informed during sustained work.

### TaskStop: stop an authorized task`,
  toolExample("TaskStop", { task_id: "actual-task-id" }),
  `Use task_id, not deprecated shell_id. Stop only this task's processes or those the user authorized you to manage.
Do not kill unrelated processes by a broad name pattern. Verify the result; stopping does not undo external side effects.

### AskUserQuestion: resolve a material missing decision`,
  toolExample("AskUserQuestion", {
    questions: [
      {
        question: "Must this interface remain compatible with existing clients?",
        header: "Compat",
        options: [
          {
            label: "Keep compatibility",
            description: "Preserve existing calls and extend the interface compatibly.",
          },
          {
            label: "Allow a change",
            description: "Update callers together and document migration.",
          },
        ],
        multiSelect: false,
      },
    ],
  }),
  `The current format supports 1-4 questions with 2-4 options each. Explicitly provide multiSelect and keep the header short.
Do not add an Other option; the UI supplies free text. Never fabricate answers or populate them on the user's behalf.
Ask only for information that affects the work and cannot reasonably be obtained from existing evidence.
Do not repeatedly request authorization already granted. When an answer is required, waiting or timing out is not consent.`,
].join("\n\n");
