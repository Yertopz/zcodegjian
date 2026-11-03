import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertDesktopPreloadBundlesAreSelfContained,
  assertNoExternalPreloadPackages,
  findExternalPreloadPackageRequires,
} from "../scripts/preload-sandbox-bundle-guard.mjs";

test("sandboxed preload allows Electron, Node built-ins, and relative chunks", () => {
  const source = 'require("electron"); require("node:events"); require("./chunk.cjs");';
  assert.deepEqual(findExternalPreloadPackageRequires(source), []);
  assert.doesNotThrow(() => assertNoExternalPreloadPackages(source));
});

test("sandboxed preload rejects external npm package requires", () => {
  assert.deepEqual(findExternalPreloadPackageRequires('require("zod");'), ["zod"]);
  assert.throws(() => assertNoExternalPreloadPackages('require("zod");', "preload/index.cjs"), {
    message: /preload\/index\.cjs leaves npm packages external: zod/u,
  });
});

test("production guard scans nested preload bundles", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "zcode-preload-bundle-"));
  const entry = join(root, "out", "preload", "index.cjs");

  try {
    await fs.mkdir(join(root, "out", "preload"), { recursive: true });
    await fs.writeFile(entry, 'require("electron"); require("node:events");');
    assert.deepEqual(await assertDesktopPreloadBundlesAreSelfContained({ desktopRoot: root }), {
      checkedBundles: 1,
    });

    await fs.mkdir(join(root, "out", "preload", "nested"));
    await fs.writeFile(join(root, "out", "preload", "nested", "chunk.cjs"), 'require("zod");');
    await assert.rejects(
      assertDesktopPreloadBundlesAreSelfContained({ desktopRoot: root }),
      /nested.*chunk\.cjs leaves npm packages external: zod/u,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
