import {
  AGENT_AVATAR_IMAGE_DATA_URL_PATTERN,
  AGENT_AVATAR_IMAGE_MAX_LENGTH,
  type AgentAvatar,
} from "@zcode/shared";

/**
 * 团队头像上传的纯校验部分。
 *
 * 抽出来的原因：校验规则（白名单 mime、字节上限、data URL 归一）必须能在没有 DOM 的
 * 单测里验证。混在 `TeamMemberAvatarPicker` 里就只能靠渲染框架测，而这套规则恰恰是
 * 「别把任意字符串塞进 <img src>」的唯一护栏，回归成本必须低。
 */

/** 上限按原始文件字节算 128 KiB：base64 会膨胀约 1/3，卡 data URL 长度用户算不出来。 */
export const TEAM_MEMBER_AVATAR_MAX_FILE_BYTES = 128 * 1024;

export const TEAM_MEMBER_AVATAR_ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

export type TeamMemberAvatarFileRejection = "unsupported" | "tooLarge" | "readFailed";

export interface TeamMemberAvatarFileLike {
  type: string;
  size: number;
}

/** 选择阶段（读文件之前）就能判掉的两种拒绝。 */
export function checkTeamMemberAvatarFile(
  file: TeamMemberAvatarFileLike,
): TeamMemberAvatarFileRejection | null {
  if (!TEAM_MEMBER_AVATAR_ACCEPTED_TYPES.includes(file.type)) {
    return "unsupported";
  }
  if (file.size > TEAM_MEMBER_AVATAR_MAX_FILE_BYTES) {
    return "tooLarge";
  }
  return null;
}

/**
 * data URL → 头像值。只接受白名单 mime 且长度在协议上限内，其余一律 null：
 * 头像会原样进 `<img src>`，放行任意字符串等于开一个不受控的 URL 通道。
 */
export function normalizeTeamMemberAvatarDataUrl(dataUrl: string): AgentAvatar | null {
  if (!dataUrl || !AGENT_AVATAR_IMAGE_DATA_URL_PATTERN.test(dataUrl)) {
    return null;
  }
  if (dataUrl.length > AGENT_AVATAR_IMAGE_MAX_LENGTH) {
    return null;
  }
  return { kind: "image", value: dataUrl };
}
