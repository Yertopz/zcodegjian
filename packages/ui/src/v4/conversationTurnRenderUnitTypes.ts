// Modified by ZCode: F2 提取带入的 F5 域类型占位 -- plugin-ui UI 侧(F5)未搬, 此处内联结构等价类型;
// F5 搬运 packages/ui/src/plugin-ui/ 后换回 import type { PluginUiRowPinResolver } from ./plugin-ui/index.js
interface PluginUiRowDisposition {
  key: string;
  superseded: boolean;
  autoExpand: boolean;
  forcedInline: boolean;
}
interface PluginUiRowPinContext {
  disposition?: PluginUiRowDisposition;
  manualPinned?: boolean;
}
type PluginUiRowPinResolver = (toolCallId: string) => PluginUiRowPinContext | undefined;
import type { BotTopicPreparation } from "@zcode/shared";
import type {
  AssistantTextRow,
  ConversationRow,
  HookInvocationRow,
  SessionPhase,
  TimelineMarkerRow,
  TurnHeaderRow,
  UserInputRow,
  WorkflowLaunchMeta,
} from "@zcode/shared/zcode-protocol-v4";
import type { AssistantWorkRow, ConversationTurnFlowItem } from "@/v4/conversationTurnFlowItems.js";
import type {
  ConversationTurnWorkSegment,
  ConversationTurnWorkStatus,
} from "@/v4/conversationTurnWorkSegments.js";
import type { HighspeedOutputFooterMark } from "@/highspeed/highspeedOutputFooter.js";

export interface ConversationTurnRenderUnit extends HighspeedOutputFooterMark {
  /** 未接受的 Bot 消息展示投影，不写入 CLI rows 或导航/分享索引。 */
  topicPreparations?: readonly BotTopicPreparation[];
  key: string;
  turnId: string;
  header?: TurnHeaderRow;
  visibleUserInputs: UserInputRow[];
  assistantWorkRows: AssistantWorkRow[];
  /**
   * 所有 visual work segment 的历史行聚合，仅供复制、预览和旧调用兼容。
   * 实际折叠边界读取 workSegments，且各段内部必须保持 CLI row 全序。
   */
  assistantHistoryRows: AssistantWorkRow[];
  /** 操作正文锚点之后、真正轮尾 marker 之前的 row；保持 CLI 全序原位渲染。 */
  assistantFollowingRows: AssistantWorkRow[];
  assistantTailRows: AssistantWorkRow[];
  /** Browser 自动轮尾截图：完成态渲染在 file diff 摘要之后、消息操作栏之前。 */
  browserTurnEndRows: AssistantWorkRow[];
  /** turn-local Hook product rows；不进入 assistant work/折叠，只供轮尾详情 action。 */
  hookInvocations: HookInvocationRow[];
  /** S2：整轮全部 assistant text 段，用于复制/预览聚合，不代表渲染位置。 */
  assistantTextRows: AssistantTextRow[];
  /** 轻边界（modelChange，S13）：渲染在 user 输入之前的轮顶分隔。 */
  leadingBoundaryRows: TimelineMarkerRow[];
  /** 完成态轮尾最终正文；fork/retry/action/preview 只挂这一段。 */
  latestAssistantTextRow?: AssistantTextRow;
  /** 同一 product turn 内 user/assistant 的可见交错顺序；相邻工作行保持成组。 */
  flowItems: ConversationTurnFlowItem[];
  /** 原始输入与每条 accepted guide 分别对应一个独立视觉工作段。 */
  workSegments?: ConversationTurnWorkSegment[];
  renderRows: ConversationRow[];
  isLastTurn: boolean;
  isRunning: boolean;
  assistantHistoryDefaultOpen: boolean;
  timelineOnly: boolean;
  /** turn 级聚合工作状态，仅供旧调用兼容；新组件消费 workSegments[].workStatus。 */
  workStatus?: ConversationTurnWorkStatus;
  startedAt?: number;
  /** 中枢直接启动轮的启动元数据（规则见 `workflowLaunchTurn.ts`）；在场时轮由 run 卡呈现、无用户气泡。 */
  workflowLaunch?: WorkflowLaunchMeta;
}

export interface BuildConversationTurnRenderUnitsOptions {
  nowMs?: number;
  sessionPhase?: SessionPhase;
  /** 插件卡片折叠裁决（时间线由推导结果 + 手动状态组装）。 */
  pluginUiPinResolver?: PluginUiRowPinResolver;
  /**
   * 必须脱离「已工作 N 秒」折叠、按 row 顺序常显的工作行。
   *
   * 群聊模式下成员回复（subagent 行 → 成员回复卡）是对话内容而不是过程记录；
   * 它排在最终正文之前，按历史规则会被分进 assistantHistory 并被 CollapsibleContent
   * 收起，用户只看到主智能体的转述。这里让这些行不进历史集合，落回常显 work 流。
   */
  visibleWorkRowIds?: ReadonlySet<number>;
}
