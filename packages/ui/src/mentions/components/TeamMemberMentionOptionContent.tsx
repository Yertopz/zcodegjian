import { TeamMemberAvatar } from "@/components/team/TeamMemberAvatar.js";
import type { MentionItem } from "@/mentions/mentionTypes.js";

interface TeamMemberMentionOptionContentProps {
  item: MentionItem;
}

/**
 * `@` 面板里的团队成员行：头像 + 名字 + 来源/模型弱信息。
 *
 * 为什么单独一个组件：MentionPlugin 已经贴着文件行数上限，
 * 而成员行还要从 `item.data` 里取头像/颜色（子智能体行是纯文本两列）。
 * 数据缺失时退回纯文本形态，不阻塞面板渲染 —— 头像只是装饰，不是事实源。
 */
export function TeamMemberMentionOptionContent({ item }: TeamMemberMentionOptionContentProps) {
  return (
    <span className="min-w-0 flex flex-1 items-center gap-2">
      <TeamMemberAvatar
        name={item.label}
        avatar={item.data?.agentAvatar}
        color={item.data?.agentColor}
        size="xs"
      />
      <span className="shrink-0 whitespace-nowrap text-ui-base font-medium text-foreground">
        {item.label}
      </span>
      {item.description ? (
        <span className="min-w-0 truncate text-ui-xs text-foreground-subtlest">
          {item.description}
        </span>
      ) : null}
    </span>
  );
}
