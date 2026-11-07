import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_AVATAR_IMAGE_MAX_LENGTH, AGENT_AVATAR_EMOJI_MAX_LENGTH } from "@zcode/shared";
import {
  TEAM_MEMBER_AVATAR_MAX_FILE_BYTES,
  TEAM_MEMBER_AVATAR_ACCEPTED_TYPES,
  checkTeamMemberAvatarFile,
  normalizeTeamMemberAvatarDataUrl,
} from "../src/settings/teamMemberAvatarInput.js";

/**
 * 团队头像上传的护栏回归。
 *
 * 关键不变量：头像会原样进 `<img src>`，因此只接受白名单 mime 的 data URL；
 * 上限按原始字节算，而不是 data URL 长度（两者差约 1/3，用户无法换算）。
 *
 * 运行：cd packages/ui && node --import tsx --test test/teamMemberAvatar.test.ts
 */

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

test("上传校验：白名单 mime 放行，其它类型拒绝", () => {
  for (const type of TEAM_MEMBER_AVATAR_ACCEPTED_TYPES) {
    assert.equal(checkTeamMemberAvatarFile({ type, size: 1024 }), null, type);
  }
  assert.equal(checkTeamMemberAvatarFile({ type: "image/svg+xml", size: 1024 }), "unsupported");
  assert.equal(checkTeamMemberAvatarFile({ type: "text/html", size: 1024 }), "unsupported");
  assert.equal(checkTeamMemberAvatarFile({ type: "", size: 1024 }), "unsupported");
});

test("上传校验：超过 128 KiB 拒绝，恰好等于上限放行", () => {
  assert.equal(
    checkTeamMemberAvatarFile({ type: "image/png", size: TEAM_MEMBER_AVATAR_MAX_FILE_BYTES }),
    null,
  );
  assert.equal(
    checkTeamMemberAvatarFile({ type: "image/png", size: TEAM_MEMBER_AVATAR_MAX_FILE_BYTES + 1 }),
    "tooLarge",
  );
});

test("data URL 归一：只接受图片 data URL，其余一律 null", () => {
  assert.deepEqual(normalizeTeamMemberAvatarDataUrl(PNG_DATA_URL), {
    kind: "image",
    value: PNG_DATA_URL,
  });
  for (const url of [
    "javascript:alert(1)",
    "http://example.com/a.png",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "",
  ]) {
    assert.equal(normalizeTeamMemberAvatarDataUrl(url), null, url);
  }
});

test("data URL 归一：超过协议长度上限返回 null", () => {
  const oversized = `${PNG_DATA_URL}${"A".repeat(AGENT_AVATAR_IMAGE_MAX_LENGTH)}`;
  assert.equal(normalizeTeamMemberAvatarDataUrl(oversized), null);
});

test("emoji 头像上限能容下带变体选择符的单个 emoji", () => {
  // 🛠️ / ✍️ 这类带 VS16 的 emoji 在 UTF-16 里占 3 个单元；Zod v4 按码点计数，
  // 上限 16 足够，但仍要确认它没被压到「一个 emoji 都存不下」。
  assert.ok(AGENT_AVATAR_EMOJI_MAX_LENGTH >= "\u{1F6E0}\uFE0F".length);
  assert.ok(AGENT_AVATAR_EMOJI_MAX_LENGTH >= 8);
});
