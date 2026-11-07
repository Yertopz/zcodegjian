import {
  DEFAULT_MULTI_AGENT_MENTION_LIMIT,
  MAIN_AGENT_CREATOR_ID,
  MULTI_AGENT_MENTION_LIMIT_MAX,
  MULTI_AGENT_MENTION_LIMIT_MIN,
  type MultiAgentSettingsPatch,
} from "@zcode/shared";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { useMultiAgentConfig, useMultiAgentCreatorOptions } from "@/hooks/useMultiAgentConfig.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { TeamMembersSection } from "@/settings/TeamMembersSection.js";

const TID_MULTI_AGENT_ENABLE = "settings-multi-agent-enable";
const TID_MULTI_AGENT_MENTION_LIMIT = "settings-multi-agent-mention-limit";
const TID_MULTI_AGENT_CREATOR = "settings-multi-agent-creator";

/**
 * 「多智能体」（agent team）设置分区。
 *
 * 数据所有者：`~/.zcode/v2/agents-state.json` 的 `multiAgent` 字段，经 `ISubagentsService` 读写。
 * 不写 AppSettings —— 便携版/多客户端共享同一份 CLI 存储，把同一事实放进两个状态所有者，
 * 迟早出现「设置页显示开启、CLI 认为未开启」。
 *
 * 只对之后新建的会话生效：CLI 在 `create-app.ts` 建会话时读一次该文件。因此文案如实说明，
 * 不给用户「点完立即变」的错误预期。
 */
export function MultiAgentSection({ workspacePath }: { workspacePath?: string | null }) {
  const { intl } = useZCodeIntl();
  const { settings, loading, error, update } = useMultiAgentConfig();
  const creatorOptions = useMultiAgentCreatorOptions(workspacePath);
  const [saving, setSaving] = useState(false);
  const [limitDraft, setLimitDraft] = useState("");
  const mentionLimit = settings?.mentionLimit ?? DEFAULT_MULTI_AGENT_MENTION_LIMIT;

  useEffect(() => {
    setLimitDraft(String(mentionLimit));
  }, [mentionLimit]);

  const ready = !loading && !saving && Boolean(settings);

  const save = async (patch: MultiAgentSettingsPatch, failureMessageId: string) => {
    setSaving(true);
    try {
      await update(patch);
    } catch (cause) {
      logger.warn("[settings] 更新多智能体设置失败", { error: String(cause) });
      toast(intl.formatMessage({ id: failureMessageId }));
    } finally {
      setSaving(false);
    }
  };

  const commitMentionLimit = () => {
    const parsed = Number.parseInt(limitDraft.trim(), 10);
    const isValid =
      Number.isInteger(parsed) &&
      parsed >= MULTI_AGENT_MENTION_LIMIT_MIN &&
      parsed <= MULTI_AGENT_MENTION_LIMIT_MAX;
    if (!isValid) {
      // 越界值不写盘：schema 会拒绝，与其让服务抛错，不如就地回落并说明范围。
      setLimitDraft(String(mentionLimit));
      toast(
        intl.formatMessage(
          { id: "settings.multiAgent.mentionLimitInvalid" },
          { min: MULTI_AGENT_MENTION_LIMIT_MIN, max: MULTI_AGENT_MENTION_LIMIT_MAX },
        ),
      );
      return;
    }
    if (parsed === mentionLimit) return;
    void save({ mentionLimit: parsed }, "settings.multiAgent.saveFailed");
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.multiAgent.enabled.label" })}
          description={intl.formatMessage({ id: "settings.multiAgent.enabled.description" })}
          control={
            <Switch
              data-testid={TID_MULTI_AGENT_ENABLE}
              checked={settings?.enabled === true}
              disabled={!ready}
              onCheckedChange={(enabled) =>
                void save({ enabled }, "settings.multiAgent.saveFailed")
              }
              aria-label={intl.formatMessage({ id: "settings.multiAgent.enabled.label" })}
            />
          }
        />

        <SettingsRow
          label={intl.formatMessage({ id: "settings.multiAgent.mentionLimit.label" })}
          description={intl.formatMessage(
            { id: "settings.multiAgent.mentionLimit.description" },
            { min: MULTI_AGENT_MENTION_LIMIT_MIN, max: MULTI_AGENT_MENTION_LIMIT_MAX },
          )}
          control={
            <Input
              data-testid={TID_MULTI_AGENT_MENTION_LIMIT}
              type="number"
              inputMode="numeric"
              min={MULTI_AGENT_MENTION_LIMIT_MIN}
              max={MULTI_AGENT_MENTION_LIMIT_MAX}
              step={1}
              value={limitDraft}
              disabled={!ready || settings?.enabled !== true}
              onChange={(event) => setLimitDraft(event.currentTarget.value)}
              onBlur={commitMentionLimit}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitMentionLimit();
              }}
              aria-label={intl.formatMessage({ id: "settings.multiAgent.mentionLimit.label" })}
            />
          }
        />

        <SettingsRow
          label={intl.formatMessage({ id: "settings.multiAgent.creator.label" })}
          description={intl.formatMessage({ id: "settings.multiAgent.creator.description" })}
          control={
            <Select
              value={settings?.creatorAgentId ?? MAIN_AGENT_CREATOR_ID}
              disabled={!ready || settings?.enabled !== true}
              onValueChange={(creatorAgentId) =>
                void save({ creatorAgentId }, "settings.multiAgent.saveFailed")
              }
            >
              <SelectTrigger
                size="lg"
                className="w-full min-w-0 justify-between"
                data-testid={TID_MULTI_AGENT_CREATOR}
                aria-label={intl.formatMessage({ id: "settings.multiAgent.creator.label" })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MAIN_AGENT_CREATOR_ID}>
                  {intl.formatMessage({ id: "settings.multiAgent.creator.main" })}
                </SelectItem>
                {creatorOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsGroupCard>

      <TeamMembersSection workspacePath={workspacePath} />

      {error ? (
        <p className="px-1 text-ui-base leading-6 text-foreground-subtle">
          {intl.formatMessage({ id: "settings.multiAgent.loadFailed" })}
        </p>
      ) : (
        <p className="px-1 text-ui-base leading-6 text-foreground-subtle">
          {intl.formatMessage(
            { id: "settings.multiAgent.takesEffectHint" },
            { limit: mentionLimit },
          )}
        </p>
      )}
    </div>
  );
}
