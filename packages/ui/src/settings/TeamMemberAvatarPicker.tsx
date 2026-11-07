import { useRef, type ChangeEvent } from "react";
import { type AgentAvatar, type AgentColor } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { TeamMemberAvatar } from "@/components/team/TeamMemberAvatar.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  checkTeamMemberAvatarFile,
  normalizeTeamMemberAvatarDataUrl,
} from "@/settings/teamMemberAvatarInput.js";

/** 预置 emoji 头像：团队成员只需要一个可辨识的脸，不要让用户先去准备图片。 */
export const TEAM_MEMBER_AVATAR_PRESETS = [
  "🦊",
  "🐼",
  "🐯",
  "🦉",
  "🐙",
  "🦄",
  "🐺",
  "🐝",
  "🤖",
  "🧠",
  "🎯",
  "🛠️",
  "📊",
  "🔍",
  "✍️",
  "🧩",
] as const;

/**
 * 上传上限与 mime 白名单在 `teamMemberAvatarInput` 里，便于无 DOM 单测覆盖。
 */

export interface TeamMemberAvatarPickerProps {
  name: string;
  color: AgentColor;
  value: AgentAvatar | null;
  onChange: (next: AgentAvatar | null) => void;
  disabled?: boolean;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read-failed"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  });
}

export function TeamMemberAvatarPicker({
  name,
  color,
  value,
  onChange,
  disabled = false,
}: TeamMemberAvatarPickerProps) {
  const { intl } = useZCodeIntl();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeEmoji = value?.kind === "emoji" ? value.value : null;

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 选同一张图两次也要触发 change，否则第二次选择静默无反应。
    event.target.value = "";
    if (!file) return;

    const rejection = checkTeamMemberAvatarFile(file);
    if (rejection === "unsupported") {
      toast(intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.avatar.unsupported" }));
      return;
    }
    if (rejection === "tooLarge") {
      toast(intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.avatar.tooLarge" }));
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const avatar = normalizeTeamMemberAvatarDataUrl(dataUrl);
      if (!avatar) {
        toast(intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.avatar.tooLarge" }));
        return;
      }
      onChange(avatar);
    } catch {
      toast(intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.avatar.readFailed" }));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <TeamMemberAvatar name={name} avatar={value} color={color} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.avatar.upload" })}
            </Button>
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onChange(null)}
              >
                {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.avatar.clear" })}
              </Button>
            ) : null}
          </div>
          <p className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.avatar.hint" })}
          </p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        data-testid="team-member-avatar-file-input"
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />

      <div
        role="radiogroup"
        aria-label={intl.formatMessage({
          id: "settings.multiAgent.teamMembers.form.avatar.presets",
        })}
        className="flex flex-wrap gap-1.5"
      >
        {TEAM_MEMBER_AVATAR_PRESETS.map((emoji) => {
          const selected = activeEmoji === emoji;
          return (
            <button
              key={emoji}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={emoji}
              disabled={disabled}
              onClick={() => onChange(selected ? null : { kind: "emoji", value: emoji })}
              className={cn(
                "flex size-8 items-center justify-center rounded-md border text-md transition-colors",
                selected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-surface hover:bg-surface-hover",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
