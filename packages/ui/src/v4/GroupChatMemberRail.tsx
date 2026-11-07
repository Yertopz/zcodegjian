import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { TeamMemberAvatar } from "@/components/team/TeamMemberAvatar.js";
import { TeamMemberIdentityRow } from "@/components/team/TeamMemberIdentityRow.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { GroupChatMemberStatus, GroupChatRosterEntry } from "@/lib/groupChatMembers.js";
import {
  testId,
  TID_CHAT_GROUP_CHAT_MEMBER_RAIL,
  TID_CHAT_GROUP_CHAT_MEMBER_RAIL_ITEM,
  TID_CHAT_GROUP_CHAT_MEMBER_RAIL_TOGGLE,
} from "@zcode/shared";

export interface GroupChatMemberRailProps {
  /** 群聊成员名册：顺序、身份信息与状态全部来自调用方的单一投影，本组件不回写。 */
  members: readonly GroupChatRosterEntry[];
  /** 局部折叠状态。只影响布局显隐，不是服务端事实，故不持久化。 */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** 只有已经跑过的成员才有 childSessionId；缺会话时按钮不可点（不隐式创建会话）。 */
  onOpenMember?: (member: GroupChatRosterEntry) => void;
  className?: string;
}

function statusLabelId(status: GroupChatMemberStatus): string {
  switch (status) {
    case "running":
      return "chat.groupChat.members.statusRunning";
    case "waiting":
      return "chat.groupChat.members.statusWaiting";
    case "blocked":
      return "chat.groupChat.members.statusBlocked";
    default:
      return "chat.groupChat.members.statusIdle";
  }
}

/**
 * 多智能体模式的左侧成员面板。
 *
 * 身份（名字 / 简介 / 头像颜色）来自 `useSubagentsStore`，运行状态来自会话的
 * subagent 投影，两者在调用方合成 `GroupChatRosterEntry[]` 后传入 —— 这里不订阅
 * 任何 store，也不做乐观更新，避免出现第二个状态所有者。
 *
 * 窄容器下整条面板隐藏（`@2xl/conversation`），此时成员身份仍然保留在每条消息卡
 * 的头顶身份行上，不会因为面板收起而丢失「谁在说话」。
 */
export function GroupChatMemberRail({
  members,
  collapsed,
  onToggleCollapsed,
  onOpenMember,
  className,
}: GroupChatMemberRailProps) {
  const { intl } = useZCodeIntl();
  const title = intl.formatMessage({ id: "chat.groupChat.members.title" });
  const toggleLabel = collapsed
    ? intl.formatMessage({ id: "chat.groupChat.members.expand" })
    : intl.formatMessage({ id: "chat.groupChat.members.collapse" });

  return (
    <aside
      data-testid={TID_CHAT_GROUP_CHAT_MEMBER_RAIL}
      data-collapsed={collapsed ? "true" : "false"}
      aria-label={title}
      className={cn(
        "hidden shrink-0 flex-col gap-2 border-l border-border py-2 pl-2 @2xl/conversation:flex",
        collapsed ? "w-11 items-center" : "w-56",
        className,
      )}
    >
      <div className={cn("flex items-center gap-1", collapsed ? "justify-center" : "pr-1")}>
        {collapsed ? null : (
          <span className="min-w-0 flex-1 truncate text-ui-xs font-medium text-foreground-subtle">
            {title}
          </span>
        )}
        {collapsed ? null : (
          <span className="shrink-0 text-ui-2xs text-foreground-subtlest">
            {intl.formatMessage({ id: "chat.groupChat.members.count" }, { count: members.length })}
          </span>
        )}
        <button
          type="button"
          data-testid={TID_CHAT_GROUP_CHAT_MEMBER_RAIL_TOGGLE}
          onClick={onToggleCollapsed}
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          title={toggleLabel}
          className="shrink-0 rounded-md p-1 text-foreground-subtle hover:bg-accent hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRightIcon className="size-4" aria-hidden="true" />
          ) : (
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
        {members.map((member) => {
          const openLabel = intl.formatMessage(
            { id: "chat.groupChat.members.openSession" },
            { name: member.name },
          );
          const statusLabel = intl.formatMessage({ id: statusLabelId(member.status) });
          const content = collapsed ? (
            <TeamMemberAvatar
              name={member.name}
              avatar={member.avatar}
              color={member.color}
              size="sm"
            />
          ) : (
            <TeamMemberIdentityRow
              name={member.name}
              description={member.description}
              avatar={member.avatar}
              color={member.color}
              status={member.status}
              statusLabel={statusLabel}
              variant="panel"
            />
          );
          const itemClassName = cn(
            "flex w-full min-w-0 items-center rounded-md border border-transparent px-1.5 py-1 text-left",
            collapsed ? "justify-center" : "justify-start",
            member.childSessionId && onOpenMember
              ? "hover:border-border hover:bg-accent"
              : "cursor-default",
          );
          return (
            <li key={member.id} className="min-w-0">
              {member.childSessionId && onOpenMember ? (
                <button
                  type="button"
                  data-testid={testId(TID_CHAT_GROUP_CHAT_MEMBER_RAIL_ITEM, member.name)}
                  data-member-name={member.name}
                  data-member-status={member.status}
                  onClick={() => onOpenMember(member)}
                  aria-label={openLabel}
                  title={collapsed ? `${member.name} · ${openLabel}` : openLabel}
                  className={itemClassName}
                >
                  {content}
                </button>
              ) : (
                <div
                  data-testid={testId(TID_CHAT_GROUP_CHAT_MEMBER_RAIL_ITEM, member.name)}
                  data-member-name={member.name}
                  data-member-status={member.status}
                  title={collapsed ? member.name : undefined}
                  className={itemClassName}
                >
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
