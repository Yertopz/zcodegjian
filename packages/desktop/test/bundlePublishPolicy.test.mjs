import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/bundle.mjs", import.meta.url));
function dryRun(...args) {
  return spawnSync(
    process.execPath,
    [script, "--os", "win", "--arch", "x64", "--dry-run", ...args],
    {
      encoding: "utf8",
      env: process.env,
    },
  );
}

test("个人云构建的 never 策略真正传到 electron-builder", () => {
  for (const args of [["--publish", "never"], ["--publish=never"]]) {
    const result = dryRun(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /electron-builder .*--win --x64 --publish never/);
  }
});

test("未指定策略保留发布默认值，显式策略沿用打包器允许集合", () => {
  const original = dryRun();
  assert.equal(original.status, 0, original.stderr);
  assert.doesNotMatch(original.stdout, /--publish/);
  for (const policy of ["always", "onTag", "onTagOrDraft"]) {
    const result = dryRun("--publish", policy);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`--publish ${policy}`));
  }
});

test("缺失值和非法发布策略在资产准备前被拒绝", () => {
  for (const args of [
    ["--publish"],
    ["--publish="],
    ["--publish", "yes"],
    ["--publish", "--skip-build"],
  ]) {
    const result = dryRun(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /不支持的发布策略/);
    assert.doesNotMatch(result.stdout, /prepare:runtime-assets|electron-builder/);
  }
});
