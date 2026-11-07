import type { AgentAvatar, AgentColor } from "@zcode/shared";
import { resolveSubagentColorFromName, SUBAGENT_COLOR_CLASS } from "@/lib/subagentColors.js";

// 字号只用 text-ui-* 阶梯（随 ui-font-size 缩放），颜色只用语义 token。
// 裸 px 字号、Tailwind 默认字号档、以及黑白透明度色都会被 designTokenRatchet 拦下。
const SIZE_CLASS = {
  xs: "size-4 text-ui-2xs",
  sm: "size-5 text-ui-xs",
  md: "size-8 text-ui-sm",
  lg: "size-10 text-ui-base",
} as const;

export type TeamMemberAvatarSize = keyof typeof SIZE_CLASS;

interface TeamMemberAvatarProps {
  name: string;
  /** 未设置头像时为 undefined；`image` 是本地 data URL，只在渲染时使用。 */
  avatar?: AgentAvatar | null;
  /** 兜底首字母底色；不传时按名字稳定哈希取色，保证同一个成员每次同一颜色。 */
  color?: AgentColor;
  size?: TeamMemberAvatarSize;
  className?: string;
}

/** 取首字符作为兜底头像文案（CJK 单字、拉丁首字母大写）。 */
function getAvatarInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
}

function cx(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/**
 * 团队成员头像的唯一渲染出口：`@` 面板、设置列表、表单预览都用它。
 *
 * 三级回退：图片 data URL → emoji → 颜色 + 首字母。
 * 为什么不直接在调用处写 img/span：三种形态的圆角、尺寸、裁切必须一致，
 * 分散实现迟早出现「面板里是方的、设置里是圆的」这类错位。
 * 图片用 `object-cover` 而不是 `object-contain`：头像语义是裁切填充，
 * 用户上传的长宽比不会被拉伸变形。
 */
export function TeamMemberAvatar({
  name,
  avatar,
  color,
  size = "sm",
  className,
}: TeamMemberAvatarProps) {
  const base = cx(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full leading-none select-none",
    SIZE_CLASS[size],
    className,
  );

  if (avatar?.kind === "image") {
    return (
      <img src={avatar.value} alt="" aria-hidden="true" className={cx(base, "object-cover")} />
    );
  }

  if (avatar?.kind === "emoji") {
    return (
      <span aria-hidden="true" className={cx(base, "bg-surface")}>
        {avatar.value}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cx(
        base,
        "font-semibold",
        SUBAGENT_COLOR_CLASS[color ?? resolveSubagentColorFromName(name)],
      )}
    >
      {getAvatarInitial(name)}
    </span>
  );
}
