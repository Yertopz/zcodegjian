import { z } from "zod";

/**
 * 页面检查器 / 表单填充契约。
 *
 * 所有操作都在 guest 的主世界执行，并以「写入后回读」的结果为准：
 * 执行未抛错不等于页面保留成功（React/Vue 受控组件常把直接赋值改回去）。
 */

export const browserConsolePageTargetSchema = z
  .object({
    instanceId: z.string().trim().min(1).max(64),
    tabId: z.string().trim().min(1).max(128),
  })
  .strict();

export const browserConsolePageSnapshotRequestSchema = browserConsolePageTargetSchema;
export type BrowserConsolePageSnapshotRequest = z.infer<
  typeof browserConsolePageSnapshotRequestSchema
>;

export const browserConsolePickElementRequestSchema = browserConsolePageTargetSchema;
export type BrowserConsolePickElementRequest = z.infer<
  typeof browserConsolePickElementRequestSchema
>;

export const browserConsolePageEditSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string().max(100_000) }).strict(),
  z.object({ kind: z.literal("value"), value: z.string().max(100_000) }).strict(),
  z.object({ kind: z.literal("html"), value: z.string().max(500_000) }).strict(),
  z
    .object({
      kind: z.literal("attribute"),
      name: z.string().trim().min(1).max(200),
      value: z.string().max(10_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("style"),
      name: z.string().trim().min(1).max(200),
      value: z.string().max(10_000),
    })
    .strict(),
]);
export type BrowserConsolePageEdit = z.infer<typeof browserConsolePageEditSchema>;

export const browserConsoleApplyEditRequestSchema = browserConsolePageTargetSchema
  .extend({
    selector: z.string().trim().min(1).max(4000),
    edit: browserConsolePageEditSchema,
  })
  .strict();
export type BrowserConsoleApplyEditRequest = z.infer<typeof browserConsoleApplyEditRequestSchema>;

export const browserConsoleFillFormRequestSchema = browserConsolePageTargetSchema
  .extend({
    values: z.record(z.string().max(2000), z.string().max(100_000)),
    onlyVisible: z.boolean().optional(),
  })
  .strict();
export type BrowserConsoleFillFormRequest = z.infer<typeof browserConsoleFillFormRequestSchema>;

export interface BrowserConsoleElementDescriptor {
  selector: string;
  tagName: string;
  text: string;
  attributes: Record<string, string>;
  value?: string;
  editable: boolean;
  visible: boolean;
  /** 命中开放 shadow root 时为 true；closed shadow root 不可见。 */
  inShadowRoot?: boolean;
}

export interface BrowserConsoleFormField {
  selector: string;
  name: string;
  label: string;
  type: string;
  value: string;
  required: boolean;
  visible: boolean;
  options?: string[];
  /** 密码字段不会进入「让 AI 填写」的上下文。 */
  sensitive?: boolean;
}

export interface BrowserConsolePageSnapshot {
  ok: boolean;
  url?: string;
  title?: string;
  elements?: BrowserConsoleElementDescriptor[];
  forms?: BrowserConsoleFormField[];
  reason?: string;
}

export type BrowserConsolePickElementResult =
  | { status: "picked"; element: BrowserConsoleElementDescriptor }
  | { status: "cancelled" }
  | { status: "unsupported"; reason: string };

export interface BrowserConsoleEditResult {
  ok: boolean;
  /** 写入前的值（用于本地撤销）。 */
  previous?: string;
  /** 写入后回读到的值；页面拒绝修改时与期望值不同。 */
  readBack?: string;
  retained: boolean;
  reason?: string;
}

export interface BrowserConsoleFillResult {
  ok: boolean;
  applied: string[];
  notApplied: string[];
  /** 页面未接受（受控组件回滚）的字段。 */
  rejected: string[];
  reason?: string;
}
