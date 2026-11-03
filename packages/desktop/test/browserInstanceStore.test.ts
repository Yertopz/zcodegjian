import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_BROWSER_INSTANCE_ID,
  DEFAULT_BROWSER_INSTANCE_PARTITION,
  browserInstancePartitionForId,
} from "@zcode/shared";
import {
  BrowserInstanceStoreError,
  createBrowserInstanceStore,
} from "../src/main/browserConsole/browserInstanceStore.js";

async function withTempStore(
  run: (input: {
    filePath: string;
    store: ReturnType<typeof createBrowserInstanceStore>;
  }) => Promise<void>,
  options: {
    maxInstances?: number;
    ids?: string[];
  } = {},
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-browser-console-store-"));
  const filePath = join(dir, "browser-instances.json");
  const ids = [...(options.ids ?? [])];
  try {
    const store = createBrowserInstanceStore({
      filePath,
      now: () => 1_000,
      ...(ids.length > 0 ? { idFactory: () => ids.shift() ?? "unexpected-id" } : {}),
      ...(options.maxInstances ? { maxInstances: options.maxInstances } : {}),
    });
    await store.load();
    await run({ filePath, store });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("load seeds the fixed default instance", async () => {
  await withTempStore(async ({ store }) => {
    const instances = store.list();
    assert.equal(instances.length, 1);
    assert.deepEqual(instances[0], {
      id: DEFAULT_BROWSER_INSTANCE_ID,
      name: "Default",
      partition: DEFAULT_BROWSER_INSTANCE_PARTITION,
      proxy: { mode: "inherit" },
      createdAt: 0,
      updatedAt: 1_000,
    });
  });
});

test("create persists a derived partition and survives reload", async () => {
  await withTempStore(
    async ({ filePath, store }) => {
      const created = await store.create({
        name: "Work",
        color: "blue",
        proxy: { mode: "fixed", protocol: "socks5", host: "127.0.0.1", port: 1080 },
      });
      assert.equal(created.partition, browserInstancePartitionForId(created.id));
      assert.equal(created.createdAt, 1_000);

      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as { version: number; instances: unknown[] };
      assert.equal(parsed.version, 1);
      assert.equal(parsed.instances.length, 2);

      const reloaded = createBrowserInstanceStore({ filePath });
      await reloaded.load();
      const fromDisk = reloaded.get(created.id);
      assert.equal(fromDisk?.name, "Work");
      assert.equal(fromDisk?.proxy.mode, "fixed");
    },
    { ids: ["inst-1"] },
  );
});

test("update rewrites fields and rejects a proxy change on the default instance", async () => {
  await withTempStore(
    async ({ store }) => {
      const created = await store.create({ name: "Work" });
      const updated = await store.update({
        id: created.id,
        name: "Work 2",
        proxy: { mode: "direct" },
      });
      assert.equal(updated.name, "Work 2");
      assert.deepEqual(updated.proxy, { mode: "direct" });

      await assert.rejects(
        store.update({
          id: DEFAULT_BROWSER_INSTANCE_ID,
          proxy: { mode: "direct" },
        }),
        (error: unknown) =>
          error instanceof BrowserInstanceStoreError && error.code === "default_immutable",
      );
    },
    { ids: ["inst-1"] },
  );
});

test("delete removes non-default instances but never the default one", async () => {
  await withTempStore(
    async ({ store }) => {
      const created = await store.create({ name: "Work" });
      await store.remove(created.id);
      assert.equal(store.get(created.id), undefined);
      assert.equal(store.list().length, 1);

      await assert.rejects(
        store.remove(DEFAULT_BROWSER_INSTANCE_ID),
        (error: unknown) =>
          error instanceof BrowserInstanceStoreError && error.code === "default_immutable",
      );
    },
    { ids: ["inst-1"] },
  );
});

test("instance limit fails explicitly instead of evicting", async () => {
  await withTempStore(
    async ({ store }) => {
      await store.create({ name: "One" });
      await assert.rejects(
        store.create({ name: "Two" }),
        (error: unknown) =>
          error instanceof BrowserInstanceStoreError && error.code === "limit_reached",
      );
    },
    { ids: ["inst-1", "inst-2"], maxInstances: 2 },
  );
});

test("a corrupt store file is preserved and replaced by the default instance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-browser-console-corrupt-"));
  const filePath = join(dir, "browser-instances.json");
  try {
    await writeFile(filePath, "{not-json", "utf8");
    const store = createBrowserInstanceStore({ filePath, now: () => 2_000 });
    await store.load();
    assert.deepEqual(
      store.list().map((record) => record.id),
      [DEFAULT_BROWSER_INSTANCE_ID],
    );
    const files = await readdir(dir);
    assert.ok(files.some((name) => name.startsWith("browser-instances.json.corrupt-")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("default instance stays first even when the persisted list is truncated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-browser-console-order-"));
  const filePath = join(dir, "browser-instances.json");
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        instances: [
          {
            id: "inst-a",
            name: "A",
            partition: browserInstancePartitionForId("inst-a"),
            proxy: { mode: "inherit" },
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "inst-b",
            name: "B",
            partition: browserInstancePartitionForId("inst-b"),
            proxy: { mode: "inherit" },
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: DEFAULT_BROWSER_INSTANCE_ID,
            name: "Default",
            partition: DEFAULT_BROWSER_INSTANCE_PARTITION,
            proxy: { mode: "inherit" },
            createdAt: 0,
            updatedAt: 1,
          },
        ],
      }),
      "utf8",
    );
    const store = createBrowserInstanceStore({ filePath, maxInstances: 2 });
    await store.load();
    assert.deepEqual(
      store.list().map((record) => record.id),
      [DEFAULT_BROWSER_INSTANCE_ID, "inst-a"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("records that reuse the default partition are dropped on load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-browser-console-partition-"));
  const filePath = join(dir, "browser-instances.json");
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        instances: [
          {
            id: DEFAULT_BROWSER_INSTANCE_ID,
            name: "Default",
            partition: DEFAULT_BROWSER_INSTANCE_PARTITION,
            proxy: { mode: "fixed", protocol: "http", host: "10.0.0.1", port: 8080 },
            createdAt: 0,
            updatedAt: 1,
          },
          {
            id: "inst-a",
            name: "Sneaky",
            partition: DEFAULT_BROWSER_INSTANCE_PARTITION,
            proxy: { mode: "inherit" },
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "inst-b",
            name: "Valid",
            partition: browserInstancePartitionForId("inst-b"),
            proxy: { mode: "inherit" },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
      "utf8",
    );
    const store = createBrowserInstanceStore({ filePath, now: () => 3_000 });
    await store.load();
    assert.deepEqual(
      store.list().map((record) => record.id),
      [DEFAULT_BROWSER_INSTANCE_ID, "inst-b"],
    );
    // 默认实例的代理在 v1 固定为继承全局，磁盘上的自定义值会被归正。
    assert.deepEqual(store.get(DEFAULT_BROWSER_INSTANCE_ID)?.proxy, { mode: "inherit" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
