import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { Client, ClientChannel } from "ssh2";
import type { ServerProfile, ServerTerminal, ServerTerminalData } from "@zcode/shared";
import { openShell } from "./sshConnection.js";

export async function createServerTerminal(context: {
  profile: ServerProfile;
  client: Client;
  generation: () => number;
  terminals: Map<string, ServerTerminal>;
  channels: Map<string, ClientChannel>;
  data: (event: ServerTerminalData) => void;
  notify: () => void;
}): Promise<{ id: string }> {
  const { profile, client, generation, terminals, channels, data, notify } = context;
  if (terminals.size >= 30) throw new Error("运行终端已达 30 个，请先关闭不用的终端");
  const gen = generation(),
    stream = await openShell(client, profile);
  if (generation() !== gen) {
    stream.close();
    throw new Error("连接已改变");
  }
  const id = randomUUID(),
    terminal: ServerTerminal = {
      id,
      serverId: profile.id,
      generation: gen,
      name: `${profile.name} · ${terminals.size + 1}`,
      output: "",
      exited: false,
      sequence: 0,
    };
  terminals.set(id, terminal);
  channels.set(id, stream);
  const stdout = new StringDecoder("utf8"),
    stderr = new StringDecoder("utf8");
  const append = (text: string) => {
    if (!text) return;
    terminal.sequence += text.length;
    terminal.output = (terminal.output + text).slice(-64000);
    data({ id, data: text, sequence: terminal.sequence });
    notify();
  };
  stream.on("data", (chunk: Buffer) => append(stdout.write(chunk)));
  stream.stderr.on("data", (chunk: Buffer) => append(stderr.write(chunk)));
  stream.once("close", () => {
    append(stdout.end());
    append(stderr.end());
    terminal.exited = true;
    channels.delete(id);
    notify();
  });
  stream.on("error", () => {
    terminal.exited = true;
    notify();
  });
  notify();
  return { id };
}
