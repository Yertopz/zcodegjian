import type { ZCodeInteractionRequestOrigin } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { Badge } from "@/components/ui/badge.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useSubagentsStore } from "@/store/subagentsStore.js";

export function InteractionRequestOriginBadge({
  className,
  origin,
}: {
  className?: string;
  origin?: ZCodeInteractionRequestOrigin;
}) {
  const { intl } = useZCodeIntl();
  // 多智能体模式下 CreateAgent 创建的成员（kind: "team"）也会以 subagent origin 上报权限请求，
  // 但它们不是子智能体。只按 origin.kind 判定会把成员审批标成「来自子智能体」。
  const isTeamMember = useSubagentsStore((state) =>
    Boolean(
      origin?.agentType &&
      state.agents.some((agent) => agent.kind === "team" && agent.name === origin.agentType),
    ),
  );
  if (origin?.kind !== "subagent") {
    return null;
  }

  const labelId = isTeamMember
    ? "chat.interactionOrigin.teamMember"
    : "chat.interactionOrigin.subagent";
  const titleId = isTeamMember
    ? "chat.interactionOrigin.teamMember.title"
    : "chat.interactionOrigin.subagent.title";
  const label = intl.formatMessage({ id: labelId });
  const title = origin.agentType
    ? intl.formatMessage({ id: titleId }, { agentType: origin.agentType })
    : label;

  return (
    <Badge
      variant="outline"
      title={title}
      data-interaction-origin-badge={isTeamMember ? "team-member" : "subagent"}
      className={cn("max-w-40 align-baseline text-ui-base truncate", className)}
    >
      {label}
    </Badge>
  );
}
