import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import ssh2, { type Connection } from "ssh2";
const { Server } = ssh2;
import { createServerWorkbenchService } from "../src/host/serverWorkbench/service.js";
import { ServerApprovalQueue } from "../src/host/serverWorkbench/approvalQueue.js";
import { buildServerCommand } from "../src/host/serverWorkbench/sshConnection.js";
import { parseServerMetrics, serverMetricsCommand } from "../src/host/serverWorkbench/metrics.js";
import { zcodeWorkspaceGenerateTextParamsSchema } from "@zcode/shared";
import {
  createServerProfileStore,
  shiftServerPassword,
} from "../src/host/serverWorkbench/profileStore.js";

test("密码偏移 3 位、重启读取、连接覆盖与清除；快照不泄露保存值", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "zcode-server-password-"));
  const storePath = join(scratch, "servers.json");
  const profile = {
    id: "fixture",
    name: "fixture",
    host: "windows.invalid",
    port: 22,
    username: "u",
    os: "windows" as const,
    shell: "powershell" as const,
    group: "",
    rdpPort: 3389,
    rdpUsername: "",
  };
  const sshPassword = "AbcXyz-19!中文",
    rdpPassword = "RdpZ-42!";
  let service: ReturnType<typeof createServerWorkbenchService> | undefined;
  const ssh: (string | undefined)[] = [],
    rdp: (string | undefined)[] = [];
  const makeService = () =>
    createServerWorkbenchService({
      storePath,
      desktopAvailable: true,
      generate: async () => "{}",
      connect: async (_p, secret) => {
        ssh.push(secret.password);
        throw new Error("fixture stopped before network");
      },
      desktop: async (r) => {
        if (r.op === "connect") rdp.push(r.password);
        return { ok: true };
      },
    });
  try {
    assert.equal(shiftServerPassword(sshPassword), "DefAbc-19!中文");
    assert.equal(shiftServerPassword(shiftServerPassword(sshPassword), -3), sshPassword);
    // 兼容原有无密码数组记录。
    await writeFile(storePath, JSON.stringify([profile]));
    service = makeService();
    assert.equal((await service.snapshot()).servers[0].hasPassword, false);
    await service.perform({
      op: "save",
      profile,
      credentials: { password: sshPassword, rdpPassword },
    });
    const records = JSON.parse(await readFile(storePath, "utf8"));
    assert.equal(records[0].credentials.password, "DefAbc-19!中文");
    assert.equal(records[0].credentials.rdpPassword, "UgsC-42!");
    const snap = await service.snapshot();
    assert.equal(snap.servers[0].hasPassword, true);
    assert.equal(snap.servers[0].hasRdpPassword, true);
    assert.equal("credentials" in snap.servers[0], false);
    assert.equal(JSON.stringify(snap).includes(sshPassword), false);
    service.dispose();
    service = makeService();
    await assert.rejects(service.perform({ op: "connect", serverId: profile.id }));
    await assert.rejects(
      service.perform({ op: "connect", serverId: profile.id, password: "once" }),
    );
    await assert.rejects(service.perform({ op: "connect", serverId: profile.id, password: "" }));
    assert.deepEqual(ssh, [sshPassword, "once", sshPassword]);
    await service.perform({
      op: "desktop",
      request: { op: "connect", serverId: profile.id, generation: 0 },
    });
    assert.deepEqual(rdp, [rdpPassword]);
    await service.perform({ op: "save", profile: { ...profile, name: "renamed" } });
    const loaded = createServerProfileStore(storePath);
    await loaded.ready;
    assert.equal(loaded.password(profile.id), sshPassword);
    await service.perform({ op: "save", profile, credentials: { password: null } });
    assert.equal((await service.snapshot()).servers[0].hasPassword, false);
    assert.equal((await service.snapshot()).servers[0].hasRdpPassword, true);
    await service.perform({ op: "delete", serverId: profile.id });
    assert.deepEqual(JSON.parse(await readFile(storePath, "utf8")), []);
  } finally {
    service?.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("审批只能消费一次；拒绝、取消和过期代次不能执行", () => {
  const queue = new ServerApprovalQueue(() => {});
  const input = { serverId: "a", generation: 1, command: "Get-Service", cwd: "", reason: "check" };
  const id = queue.propose(input);
  const exposed = queue.list();
  exposed[0].command = "malicious";
  assert.equal(queue.take(id, true, 1)?.command, "Get-Service");
  assert.throws(() => queue.take(id, true, 1));
  assert.equal(queue.take(queue.propose(input), false, 1), null);
  assert.throws(() => queue.take(queue.propose(input), true, 2));
  const cancelled = queue.propose(input);
  queue.cancel("a");
  assert.throws(() => queue.take(cancelled, true, 1));
});

test("RDP 建议只在批准后投递；人工接管和重连使旧截图动作失效", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "zcode-rdp-approval-"));
  let revision = 0,
    inputs = 0;
  const service = createServerWorkbenchService({
    storePath: join(scratch, "servers.json"),
    desktopAvailable: true,
    generate: async () =>
      JSON.stringify({
        reply: "建议检查",
        actions: [{ action: { kind: "click", x: 5, y: 5 }, reason: "打开服务" }],
      }),
    desktop: async (r) => {
      if (r.op === "input") {
        inputs++;
        return { ok: r.interactionRevision === revision };
      }
      return {
        ok: true,
        state: "connected",
        interactionRevision: revision,
        ...(r.op === "capture" ? { image: "data:image/png;base64,AA==" } : {}),
      };
    },
  });
  try {
    const { id } = await service.perform({
      op: "save",
      profile: {
        name: "fixture",
        host: "windows.invalid",
        username: "u",
        os: "windows",
        shell: "powershell",
      },
    });
    await service.perform({
      op: "desktop",
      request: { op: "connect", serverId: id!, generation: 0 },
    });
    const analyze = () =>
      service.perform({
        op: "assistant",
        serverId: id!,
        text: "检查错误",
        includeOutput: false,
        includeDesktop: true,
      });
    await analyze();
    assert.equal(inputs, 0);
    let p = (await service.snapshot()).proposals.at(-1)!;
    await service.perform({ op: "decide", id: p.id, allow: true });
    assert.equal(inputs, 1);
    await assert.rejects(service.perform({ op: "decide", id: p.id, allow: true }));
    assert.equal(inputs, 1);
    await analyze();
    p = (await service.snapshot()).proposals.at(-1)!;
    revision++;
    await service.perform({
      op: "desktop",
      request: { op: "probe", serverId: id!, generation: 0 },
    });
    await assert.rejects(service.perform({ op: "decide", id: p.id, allow: true }));
    assert.equal(inputs, 1);
    await analyze();
    p = (await service.snapshot()).proposals.at(-1)!;
    await service.perform({
      op: "desktop",
      request: { op: "connect", serverId: id!, generation: 0 },
    });
    await assert.rejects(service.perform({ op: "decide", id: p.id, allow: true }));
    assert.equal(inputs, 1);
  } finally {
    service.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("指标校验和辅助生成图片协议保持严格边界", () => {
  assert.equal(parseServerMetrics('{"cpu":12,"memory":30,"disk":50}', "x", 1).cpu, 12);
  assert.throws(() => parseServerMetrics('{"cpu":1000,"memory":30,"disk":50}', "x", 1));
  assert.match(serverMetricsCommand({ os: "linux" } as never), /\/proc\/stat/);
  const base = {
    workspace: { workspaceKey: "fixture", workspacePath: "C:/fixture" },
    selection: { providerId: "test", modelId: "test" },
    querySource: "server-workbench",
    tools: [],
  };
  const valid = zcodeWorkspaceGenerateTextParamsSchema.safeParse({
    ...base,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "check" },
          { type: "image", mediaType: "image/png", dataUrl: "data:image/png;base64,AA==" },
        ],
      },
    ],
  });
  assert.equal(valid.success, true, valid.success ? "" : valid.error.message);
  assert.equal(
    zcodeWorkspaceGenerateTextParamsSchema.safeParse({
      ...base,
      messages: [
        {
          role: "user",
          content: [{ type: "image", mediaType: "image/png", dataUrl: "file:///secret.png" }],
        },
      ],
    }).success,
    false,
  );
});

test("Windows 和 POSIX 工作目录不能通过 quoting 注入隐藏命令", () => {
  const common = {
    id: "x",
    name: "x",
    host: "localhost",
    port: 22,
    username: "u",
    group: "",
    rdpPort: 3389,
    rdpUsername: "",
  };
  const windows = { ...common, os: "windows" as const, shell: "powershell" as const };
  const encoded = buildServerCommand(windows, "Get-Process", "C:\\Users\\O'Brien");
  assert.match(Buffer.from(encoded.split(" ").at(-1)!, "base64").toString("utf16le"), /O''Brien/);
  assert.throws(() => buildServerCommand({ ...windows, shell: "cmd" }, "dir", "C:\\test&whoami"));
  assert.throws(() => buildServerCommand(windows, "Get-Date", "C:\\x\nwhoami"));
  const posix = buildServerCommand(
    { ...common, os: "linux", shell: "sh" },
    "pwd",
    "/tmp/with'quote",
  );
  assert.match(posix, /sh -c/);
});

// 真实 loopback SSH 握手和 channel；测试端只记录命令，不执行远端 shell。
// 临时预算 < 1 MiB，不连接图片中的地址，不使用用户凭据，finally 回收连接和文件。
test(
  "Host: 指纹、审批、AI 提案、Windows PTY 与精确关闭的真实 SSH 回环",
  { timeout: 30_000 },
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), "zcode-server-workbench-"));
    const key = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs1" },
      publicKeyEncoding: { format: "pem", type: "pkcs1" },
    }).privateKey;
    const commands: string[] = [],
      peers = new Set<Connection>();
    const server = new Server({ hostKeys: [key] }, (peer) => {
      peers.add(peer);
      peer.on("error", () => {});
      peer.once("close", () => peers.delete(peer));
      peer
        .on("authentication", (ctx) => ctx.accept())
        .on("ready", () => {
          peer.on("session", (accept) => {
            const session = accept();
            session.on("pty", (accept) => accept());
            session.on("exec", (accept, _reject, info) => {
              const stream = accept();
              if (
                info.command.endsWith("-NoProfile") ||
                info.command === "sh -i" ||
                info.command === "cmd.exe /d"
              ) {
                stream.write("ready\r\n");
                stream.on("data", (data) => stream.write(data));
                return;
              }
              commands.push(info.command);
              stream.write("diagnostic output");
              stream.exit(0);
              stream.end();
            });
          });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(typeof address === "object" && address);
    const desktopCalls: unknown[] = [];
    const service = createServerWorkbenchService({
      storePath: join(scratch, "servers.json"),
      desktopAvailable: true,
      desktop: async (r) => {
        desktopCalls.push(r);
        return { ok: true };
      },
      generate: async () =>
        JSON.stringify({
          reply: "建议检查服务",
          commands: [{ command: "Get-Service", cwd: "", reason: "查看状态" }],
        }),
    });
    try {
      const saved = await service.perform({
        op: "save",
        profile: {
          name: "test",
          host: "127.0.0.1",
          port: address.port,
          username: "test",
          os: "windows",
          shell: "powershell",
        },
      });
      assert.ok(saved.id);
      const id = saved.id;
      const first = await service.perform({ op: "connect", serverId: id, password: "test" });
      assert.equal(first.trustRequired, true);
      assert.match(first.fingerprint!, /^SHA256:/);
      await service.perform({
        op: "connect",
        serverId: id,
        password: "test",
        fingerprint: first.fingerprint,
      });
      assert.equal(commands.length, 0);
      await service.perform({ op: "assistant", serverId: id, text: "check", includeOutput: false });
      assert.equal(commands.length, 0);
      let snap = await service.snapshot();
      const pending = snap.proposals[0];
      assert.equal(pending.state, "pending");
      await service.perform({ op: "decide", id: pending.id, allow: true });
      assert.equal(commands.length, 1);
      assert.match(
        Buffer.from(commands[0].split(" ").at(-1)!, "base64").toString("utf16le"),
        /Get-Service/,
      );
      await assert.rejects(service.perform({ op: "decide", id: pending.id, allow: true }));
      assert.equal(commands.length, 1);
      const reject = await service.perform({
        op: "propose",
        serverId: id,
        command: "Restart-Service",
        cwd: "",
        reason: "test",
      });
      await service.perform({ op: "decide", id: reject.id!, allow: false });
      assert.equal(commands.length, 1);
      const one = await service.perform({ op: "terminalCreate", serverId: id }),
        two = await service.perform({ op: "terminalCreate", serverId: id });
      await service.perform({ op: "terminalClose", id: one.id! });
      snap = await service.snapshot();
      assert.equal(snap.terminals.length, 1);
      assert.equal(snap.terminals[0].id, two.id);
      await service.perform({ op: "terminalWrite", id: two.id!, data: "hello\r" });
      const stale = await service.perform({
        op: "propose",
        serverId: id,
        command: "Get-Date",
        cwd: "",
        reason: "test",
      });
      await service.perform({ op: "disconnect", serverId: id });
      await assert.rejects(service.perform({ op: "decide", id: stale.id!, allow: true }));
      assert.equal(commands.length, 1);
      assert.equal((await service.snapshot()).terminals.length, 0);
    } finally {
      service.dispose();
      for (const peer of peers) peer.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
