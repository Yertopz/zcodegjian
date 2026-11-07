// 团队成员身份行：头像 + 名字 + 简介。
//
// 为什么单独抽出来：群聊视图里同一份身份要出现在三处（SendMessage 群聊消息卡、
// Agent 回复预览卡、Agent 工具卡的团队成员态）和左侧成员面板。三处各自拼
// 头像与文字，很快会漂移成「消息卡只有首字母色块、面板有头像」这类不一致。
// 身份表达只有这一个实现，尺寸差异走 variant。
//
// 头像渲染不在本文件：唯一实现是 TeamMemberAvatar（图片 → emoji → 颜色 + 首字），
// 它同时是设置页、@ 面板、工作流时间线用的同一个组件。
import { testId, TID_CHAT_GROUP_CHAT_IDENTITY } from "@zcode/shared";
import type { AgentAvatar, AgentColor } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { TeamMemberAvatar } from "@/components/team/TeamMemberAvatar.js";
import { isSubagentColor } from "@/lib/subagentColors.js";

export type TeamMemberIdentityRowVariant = "inline" | "panel";

export interface TeamMemberIdentityRowProps {
  name: string;
  /** 一句话简介（agent profile 的 description）；为空时不占位。 */
  description?: string;
  avatar?: AgentAvatar | null;
  color?: AgentColor | string | null;
  /**
   * inline：消息卡/工具卡头部，横向一行，密度与周围摘要文字一致。
   * panel：左侧成员面板的一行，头像更大、名字与简介分两行。
   */
  variant?: TeamMemberIdentityRowVariant;
  /**
   * 简介的位置：below = 名字下一行（面板与设置页的既有形态，默认值保持零回归）；
   * inline = 与名字同行、中点分隔（`名字 · 简介`），群聊消息头的形态。
   * 为什么要分：群聊消息头右侧要留时间/状态的位置，纵向占两行会把卡片头部抬高一倍。
   */
  descriptionPlacement?: "below" | "inline";
  /** 面板行的状态文案（空闲 / 运行中 / 等待中 / 已阻塞）；inline 不用。 */
  statusLabel?: string;
  /** 供状态样式与测试断言使用的原始状态值。 */
  status?: "running" | "waiting" | "blocked" | "idle";
  className?: string;
}

export function TeamMemberIdentityRow({
  name,
  description,
  avatar,
  color,
  variant = "inline",
  descriptionPlacement = "below",
  statusLabel,
  status,
  className,
}: TeamMemberIdentityRowProps) {
  const trimmedDescription = description?.trim() || undefined;
  const isPanel = variant === "panel";
  const inlineDescription = descriptionPlacement === "inline" && Boolean(trimmedDescription);
  // 颜色来源跨了三层（AgentSummary.color / GroupChatMemberInfo.color 是 string），
  // 非法值不能透给 TeamMemberAvatar 的严格枚举，否则记录到的错误枚举会静默变成 undefined 底色。
  const avatarColor = color && isSubagentColor(color) ? color : undefined;

  return (
    // 根节点用 span：这一行也会被塞进工具卡摘要行的 <span> 容器（ToolSummaryRow），
    // div 嵌在 span 里虽然能渲染，但语义与样式约束都是错的；flex 由类名提供。
    <span
      data-testid={testId(TID_CHAT_GROUP_CHAT_IDENTITY, name)}
      data-member-status={status}
      className={cn("flex min-w-0 items-center", isPanel ? "gap-2.5" : "gap-2", className)}
    >
      <TeamMemberAvatar
        name={name}
        avatar={avatar ?? undefined}
        color={avatarColor}
        size={isPanel ? "md" : "xs"}
        className="shrink-0"
      />
      <span className={cn("flex min-w-0 flex-col", isPanel ? "gap-0.5" : "gap-0")}>
        <span
          className={cn(
            "flex min-w-0",
            inlineDescription ? "items-baseline gap-1.5" : "items-center gap-1.5",
          )}
        >
          <span
            className={cn(
              "truncate text-foreground",
              isPanel ? "text-ui-sm font-medium" : "text-ui-base font-medium",
              inlineDescription ? "shrink-0" : undefined,
            )}
            title={name}
          >
            {name}
          </span>
          {inlineDescription ? (
            <>
              {/* 中点只是排版分隔符，读屏不需要念「点」。 */}
              <span aria-hidden className="shrink-0 text-ui-sm text-foreground-subtlest">
                ·
              </span>
              <span
                className={cn(
                  "min-w-0 truncate text-foreground-subtlest",
                  isPanel ? "text-ui-xs" : "text-ui-sm",
                )}
                title={trimmedDescription}
              >
                {trimmedDescription}
              </span>
            </>
          ) : null}
          {statusLabel ? (
            // 状态不能只靠颜色：文案与颜色同时出现（DESIGN.md 可访问性约束）。
            <span
              className={cn(
                "shrink-0 text-ui-2xs",
                status === "running" || status === "waiting"
                  ? "text-warning"
                  : status === "blocked"
                    ? "text-danger"
                    : "text-foreground-subtlest",
              )}
            >
              {statusLabel}
            </span>
          ) : null}
        </span>
        {!inlineDescription && trimmedDescription ? (
          <span
            className={cn(
              "truncate text-foreground-subtlest",
              isPanel ? "text-ui-xs" : "text-ui-sm",
            )}
            title={trimmedDescription}
          >
            {trimmedDescription}
          </span>
        ) : null}
      </span>
    </span>
  );
}
