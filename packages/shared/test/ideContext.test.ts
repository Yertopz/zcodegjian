import assert from "node:assert/strict";
import test from "node:test";
import { ideContextSchema, composeIdePrompt } from "../src/ide-context.js";
import { commandPayloadSchemas } from "../src/zcode-protocol-v4/command.js";

test("IDE context validates version and absolute local/remote paths", () => {
  for (const absolutePath of ["C:\\project\\a.ts", "/home/project/a.ts", "\\\\host\\share\\a.ts"]) {
    const context = ideContextSchema.parse({
      version: 1,
      activeFile: { absolutePath, hasUnsavedChanges: true },
    });
    assert.ok(composeIdePrompt(context).includes(JSON.stringify(absolutePath)));
  }
  for (const activeFile of [
    { absolutePath: "a.ts", hasUnsavedChanges: false },
    { absolutePath: "/a\nb", hasUnsavedChanges: false },
  ]) {
    assert.equal(ideContextSchema.safeParse({ version: 1, activeFile }).success, false);
  }
  assert.equal(ideContextSchema.safeParse({ version: 2, activeFile: null }).success, false);
  assert.equal(ideContextSchema.parse({ version: 1, activeFile: null }).activeFile, null);
});

test("sendText and first input validate IDE context; old inputs stay compatible", () => {
  const ideContext = { version: 1, activeFile: null };
  assert.deepEqual(
    commandPayloadSchemas.sendText.parse({ text: "test", ideContext }).ideContext,
    ideContext,
  );
  assert.deepEqual(
    commandPayloadSchemas.createSession.parse({
      workspaceId: "w",
      firstInput: { text: "test", ideContext },
    }).firstInput?.ideContext,
    ideContext,
  );
  assert.equal(
    commandPayloadSchemas.sendText.safeParse({
      text: "test",
      ideContext: { version: 2, activeFile: null },
    }).success,
    false,
  );
  assert.equal(commandPayloadSchemas.sendText.parse({ text: "old" }).ideContext, undefined);
});
