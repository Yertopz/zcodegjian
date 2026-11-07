import { z } from "zod";

export const serverProfileSchema = z
  .object({
    id: z.string().max(100).optional(),
    name: z.string().trim().min(1).max(100),
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().trim().min(1).max(100),
    os: z.enum(["windows", "linux"]),
    shell: z.enum(["powershell", "cmd", "sh"]),
    group: z.string().max(80).default(""),
    privateKeyPath: z.string().max(4096).optional(),
    fingerprint: z.string().max(100).optional(),
    rdpPort: z.number().int().min(1).max(65535).default(3389),
    rdpHost: z.string().trim().max(253).optional(),
    rdpUsername: z.string().max(100).default(""),
    hasPassword: z.boolean().optional(),
    hasRdpPassword: z.boolean().optional(),
  })
  .strict();
export type ServerProfile = z.infer<typeof serverProfileSchema> & { id: string };
/** 仅 Host 磁盘记录使用；公共快照不返回 credentials。 */
export const serverStoredProfileSchema = serverProfileSchema.extend({
  credentials: z
    .object({
      password: z.string().max(8192).optional(),
      rdpPassword: z.string().max(8192).optional(),
    })
    .strict()
    .optional(),
});
export type ServerState = "offline" | "connecting" | "online" | "failed";
export interface ServerConnection {
  serverId: string;
  generation: number;
  state: ServerState;
  error?: string;
}
export interface ServerTerminal {
  sequence: number;
  id: string;
  serverId: string;
  generation: number;
  name: string;
  output: string;
  exited: boolean;
}
export interface ServerTerminalData {
  id: string;
  data: string;
  sequence: number;
}
export interface ServerFile {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  modified: number;
}
export interface ServerTransfer {
  id: string;
  serverId: string;
  generation: number;
  source: string;
  destination: string;
  direction: "upload" | "download";
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  sha256?: string;
  resumeAvailable?: boolean;
  bytes: number;
  total: number;
  startedAt: number;
  error?: string;
}
export const serverDesktopActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("click"),
      x: z.number().int().min(0).max(8192),
      y: z.number().int().min(0).max(8192),
    })
    .strict(),
  z.object({ kind: z.literal("key"), key: z.number().int().min(1).max(255) }).strict(),
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(8192) }).strict(),
]);
export type ServerDesktopAction = z.infer<typeof serverDesktopActionSchema>;
export interface ServerProposal {
  purpose?: "metrics";
  desktopRevision?: number;
  id: string;
  serverId: string;
  generation: number;
  command: string;
  cwd: string;
  reason: string;
  action?: ServerDesktopAction;
  state: "pending" | "running" | "completed" | "rejected" | "failed" | "cancelled";
  output?: string;
  exitCode?: number;
  createdAt: number;
}
export interface ServerAssistantMessage {
  id: string;
  serverId: string;
  role: "user" | "assistant";
  text: string;
}
export interface ServerWorkbenchSnapshot {
  metrics: ServerMetrics[];
  servers: ServerProfile[];
  connections: ServerConnection[];
  terminals: ServerTerminal[];
  proposals: ServerProposal[];
  transfers: ServerTransfer[];
  messages: ServerAssistantMessage[];
  desktopAvailable: boolean;
}
export interface ServerMetrics {
  serverId: string;
  generation: number;
  sampledAt: number;
  cpu: number;
  memory: number;
  disk: number;
}
const requiredId = z.string().min(1).max(100);
const path = z.string().max(4096);
export const serverWorkbenchRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("metrics"), serverId: requiredId }).strict(),
  z
    .object({ op: z.literal("desktop"), request: z.lazy(() => serverDesktopRequestSchema) })
    .strict(),
  z
    .object({
      op: z.literal("save"),
      profile: serverProfileSchema,
      credentials: z
        .object({
          password: z.string().max(8192).nullable().optional(),
          rdpPassword: z.string().max(8192).nullable().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z.object({ op: z.literal("delete"), serverId: requiredId }).strict(),
  z
    .object({
      op: z.literal("connect"),
      serverId: requiredId,
      password: z.string().max(8192).optional(),
      passphrase: z.string().max(8192).optional(),
      fingerprint: z.string().max(100).optional(),
    })
    .strict(),
  z.object({ op: z.literal("disconnect"), serverId: requiredId }).strict(),
  z.object({ op: z.literal("terminalCreate"), serverId: requiredId }).strict(),
  z
    .object({ op: z.literal("terminalWrite"), id: requiredId, data: z.string().max(65536) })
    .strict(),
  z
    .object({
      op: z.literal("terminalResize"),
      id: requiredId,
      cols: z.number().int().min(2).max(500),
      rows: z.number().int().min(1).max(250),
    })
    .strict(),
  z.object({ op: z.literal("terminalClose"), id: requiredId }).strict(),
  z
    .object({
      op: z.literal("terminalRename"),
      id: requiredId,
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z.object({ op: z.literal("files"), serverId: requiredId.optional(), path }).strict(),
  z
    .object({
      op: z.literal("transfer"),
      serverId: requiredId,
      source: path.min(1),
      destination: path.min(1),
      direction: z.enum(["upload", "download"]),
      overwrite: z.boolean().default(false),
      resumeId: requiredId.optional(),
    })
    .strict(),
  z.object({ op: z.literal("transferCancel"), id: requiredId }).strict(),
  z
    .object({
      op: z.literal("propose"),
      serverId: requiredId,
      command: z.string().min(1).max(16384),
      cwd: path,
      reason: z.string().max(2000),
      action: serverDesktopActionSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal("decide"), id: requiredId, allow: z.boolean() }).strict(),
  z.object({ op: z.literal("cancel"), serverId: requiredId }).strict(),
  z
    .object({
      op: z.literal("assistant"),
      serverId: requiredId,
      text: z.string().min(1).max(12000),
      includeOutput: z.boolean(),
      includeDesktop: z.boolean().default(false),
    })
    .strict(),
]);
export type ServerWorkbenchRequest = z.input<typeof serverWorkbenchRequestSchema>;
export interface ServerWorkbenchResult {
  interactionRevision?: number;
  ok?: boolean;
  state?: string;
  image?: string;
  available?: boolean;
  id?: string;
  files?: ServerFile[];
  path?: string;
  truncated?: boolean;
  fingerprint?: string;
  trustRequired?: boolean;
}
export const serverDesktopRequestSchema = z
  .object({
    op: z.enum(["connect", "disconnect", "bounds", "input", "capture", "probe"]),
    serverId: requiredId,
    generation: z.number().int().nonnegative(),
    interactionRevision: z.number().int().nonnegative().optional(),
    host: z.string().max(253).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().max(100).optional(),
    password: z.string().max(8192).optional(),
    bounds: z
      .object({
        x: z.number().int(),
        y: z.number().int(),
        width: z.number().int().min(0).max(8192),
        height: z.number().int().min(0).max(8192),
        visible: z.boolean(),
      })
      .strict()
      .optional(),
    action: serverDesktopActionSchema.optional(),
  })
  .strict();
export type ServerDesktopRequest = z.infer<typeof serverDesktopRequestSchema>;
export interface ServerDesktopResult {
  interactionRevision?: number;
  ok: boolean;
  error?: string;
  image?: string;
  available?: boolean;
  state?: string;
}
