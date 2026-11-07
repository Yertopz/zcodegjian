/* eslint-disable max-lines -- 团队成员表单是一个整体：字段互相牵连（名字决定颜色/头像回退、
模型与工具联动校验），拆成多个文件反而让「同一份配置的两处编辑」更难对齐。 */
import { useState, type FormEvent } from "react";
import { Check, Trash2 } from "lucide-react";
import {
  type AgentAvatar,
  type AgentColor,
  type AgentPermissionMode,
  type AgentSummary,
  type ModelSelection,
  type SubAgentConfig,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  SUBAGENT_COLORS,
  SUBAGENT_COLOR_CLASS,
  resolveSubagentColorFromName,
} from "@/lib/subagentColors.js";
import { parseModelPickerValue } from "@/lib/zcodeSessionProjection.js";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { SettingsFormActions } from "@/settings/SettingsFormActions.js";
import { SettingsFormTextarea } from "@/settings/SettingsFormTextarea.js";
import { TeamMemberAvatarPicker } from "@/settings/TeamMemberAvatarPicker.js";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";

const INHERIT_MODEL_VALUE = "inherit";
const TOOL_OPTIONS = [
  "Read",
  "Grep",
  "Glob",
  "Bash",
  "Edit",
  "Write",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
] as const;
const TOOL_OPTION_SET = new Set<string>(TOOL_OPTIONS);
const AGENT_COLORS: AgentColor[] = [...SUBAGENT_COLORS];
const COLOR_DOT_CLASS: Record<AgentColor, string> = SUBAGENT_COLOR_CLASS;

export interface TeamMemberFormSubmit {
  config: SubAgentConfig;
  avatar: AgentAvatar | null;
}

export interface TeamMemberFormProps {
  /** null = 新建团队成员。 */
  agent: AgentSummary | null;
  modelGroups: readonly ModelSelectGroup[];
  saving: boolean;
  onSubmit: (values: TeamMemberFormSubmit) => void;
  onCancel: () => void;
  onDelete?: (agent: AgentSummary) => void;
}

function FormFieldLabel({ children }: { children: string }) {
  return (
    <label className="mb-1.5 block text-ui-base font-medium text-foreground-subtle">
      {children}
    </label>
  );
}

/** 通配符 `*` 与空数组都表示「全部工具」，不能按数组长度当成 1 个。 */
function allowsAllTools(tools: readonly string[] | undefined): boolean {
  return !tools || tools.length === 0 || tools.some((tool) => tool.trim() === "*");
}

function getKnownTools(values: readonly string[] | undefined): string[] {
  return values?.filter((tool) => TOOL_OPTION_SET.has(tool)) ?? [];
}

/** 保留用户手写但不在候选表里的工具，保存时原样写回，不能因为不在列表里就丢配置。 */
function getPreservedTools(values: readonly string[] | undefined): string[] {
  return values?.filter((tool) => !TOOL_OPTION_SET.has(tool) && tool.trim() !== "*") ?? [];
}

function mergeTools(
  selected: readonly string[],
  preserved: readonly string[],
): string[] | undefined {
  const merged = [...selected, ...preserved].filter(
    (tool, index, tools) => tool.trim().length > 0 && tools.indexOf(tool) === index,
  );
  return merged.length > 0 ? merged : undefined;
}

function toModelValue(selection: ModelSelection | undefined): string {
  return selection
    ? encodeCustomModelValue(selection.providerId, selection.modelId)
    : INHERIT_MODEL_VALUE;
}

/**
 * 模型没改就复用原对象：`ModelSelection.options` 里可能带 reasoningLevel，
 * 重新拼一个对象会把用户此前选的思考档位静默清掉。
 */
function toModelSelection(
  model: string,
  previous: ModelSelection | undefined,
): ModelSelection | undefined {
  if (!model || model === INHERIT_MODEL_VALUE) {
    return undefined;
  }
  const { providerId, modelId } = parseModelPickerValue(model);
  if (previous && previous.providerId === providerId && previous.modelId === modelId) {
    return previous;
  }
  return { providerId, modelId };
}

export function TeamMemberForm({
  agent,
  modelGroups,
  saving,
  onSubmit,
  onCancel,
  onDelete,
}: TeamMemberFormProps) {
  const { intl } = useZCodeIntl();
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [color, setColor] = useState<AgentColor>(
    agent?.color ?? resolveSubagentColorFromName(agent?.name ?? "team-member"),
  );
  const [avatar, setAvatar] = useState<AgentAvatar | null>(agent?.avatar ?? null);
  const [model, setModel] = useState(toModelValue(agent?.modelSelection));
  const [inheritAllTools, setInheritAllTools] = useState(allowsAllTools(agent?.tools));
  const [selectedTools, setSelectedTools] = useState<string[]>(getKnownTools(agent?.tools));
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>(
    agent?.permissionMode ?? "auto",
  );
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [submitted, setSubmitted] = useState(false);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const trimmedPrompt = systemPrompt.trim();

  // 与 services 端 validateUserAgentConfig 的规则保持一致：名字是 @ 提到的 token，
  // 只能 ASCII；保存后才报错会让用户以为配置已写入。
  const nameError =
    trimmedName.length === 0
      ? intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.validation.nameRequired" })
      : !/^[a-zA-Z0-9-]+$/.test(trimmedName)
        ? intl.formatMessage({
            id: "settings.multiAgent.teamMembers.form.validation.nameCharacters",
          })
        : trimmedName.length < 3 || trimmedName.length > 50
          ? intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.validation.nameLength" })
          : "";
  const descriptionError =
    trimmedDescription.length === 0
      ? intl.formatMessage({
          id: "settings.multiAgent.teamMembers.form.validation.descriptionRequired",
        })
      : "";
  const promptError =
    trimmedPrompt.length === 0
      ? intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.validation.promptRequired" })
      : "";
  const toolsError =
    !inheritAllTools && selectedTools.length === 0
      ? intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.validation.toolsRequired" })
      : "";

  const canSave = !nameError && !descriptionError && !promptError && !toolsError;

  const toggleTool = (tool: string) => {
    setSelectedTools((current) =>
      current.includes(tool) ? current.filter((item) => item !== tool) : [...current, tool],
    );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!canSave) return;

    const modelSelection = toModelSelection(model, agent?.modelSelection);
    const config: SubAgentConfig = {
      name: trimmedName,
      description: trimmedDescription,
      systemPrompt: trimmedPrompt,
      color,
      kind: "team",
      permissionMode,
      ...(modelSelection ? { modelSelection } : {}),
      ...(inheritAllTools
        ? {}
        : { tools: mergeTools(selectedTools, getPreservedTools(agent?.tools)) }),
      // 团队成员的其余配置不在本表单里编辑，编辑时原样带回，避免保存一次就丢字段。
      ...(agent?.disallowedTools ? { disallowedTools: agent.disallowedTools } : {}),
      ...(agent?.skills ? { skills: agent.skills } : {}),
      ...(agent?.injectAgentsMd !== undefined ? { injectAgentsMd: agent.injectAgentsMd } : {}),
      ...(agent?.maxTurns !== undefined ? { maxTurns: agent.maxTurns } : {}),
      ...(agent?.background !== undefined ? { background: agent.background } : {}),
      ...(agent?.mcpServers ? { mcpServers: agent.mcpServers } : {}),
    };
    onSubmit({ config, avatar });
  };

  const showError = (message: string) =>
    submitted && message ? <p className="text-ui-base text-destructive">{message}</p> : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-border p-4">
      <div className="space-y-1.5">
        <FormFieldLabel>
          {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.avatar.label" })}
        </FormFieldLabel>
        <TeamMemberAvatarPicker
          name={trimmedName || "team-member"}
          color={color}
          value={avatar}
          disabled={saving}
          onChange={setAvatar}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(12rem,14rem)_auto_minmax(0,1fr)] md:items-start">
        <div className="space-y-1.5">
          <FormFieldLabel>
            {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.name.label" })}
          </FormFieldLabel>
          <Input
            type="text"
            size="lg"
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
            placeholder={intl.formatMessage({
              id: "settings.multiAgent.teamMembers.form.name.placeholder",
            })}
          />
          {showError(nameError)}
        </div>
        <div className="space-y-1.5">
          <FormFieldLabel>
            {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.color.label" })}
          </FormFieldLabel>
          <div
            role="radiogroup"
            aria-label={intl.formatMessage({
              id: "settings.multiAgent.teamMembers.form.color.label",
            })}
            className="inline-grid grid-cols-8 gap-1 rounded-lg border border-input-border bg-input p-1"
          >
            {AGENT_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={color === option}
                aria-label={intl.formatMessage({ id: `settings.subagents.color.${option}` })}
                disabled={saving}
                className="flex size-6 items-center justify-center rounded-full outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setColor(option)}
              >
                <span className={cn("size-3.5 rounded-full", COLOR_DOT_CLASS[option])} />
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <FormFieldLabel>
            {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.model.label" })}
          </FormFieldLabel>
          <Select value={model} onValueChange={setModel} disabled={saving}>
            <SelectTrigger size="lg" className="w-fit justify-between">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT_MODEL_VALUE}>
                {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.model.inherit" })}
              </SelectItem>
              {modelGroups.flatMap((group) =>
                group.items.map((item) => (
                  <SelectItem key={`${group.key}-${item.key}`} value={item.value}>
                    {item.name}
                  </SelectItem>
                )),
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <FormFieldLabel>
          {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.description.label" })}
        </FormFieldLabel>
        <Input
          type="text"
          size="lg"
          value={description}
          disabled={saving}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={intl.formatMessage({
            id: "settings.multiAgent.teamMembers.form.description.placeholder",
          })}
        />
        {showError(descriptionError)}
      </div>

      <div className="space-y-1.5">
        <FormFieldLabel>
          {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.permissionMode.label" })}
        </FormFieldLabel>
        <Select
          value={permissionMode}
          disabled={saving}
          onValueChange={(next) => setPermissionMode(next === "plan" ? "plan" : "auto")}
        >
          <SelectTrigger size="lg" className="w-fit justify-between">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              {intl.formatMessage({
                id: "settings.multiAgent.teamMembers.form.permissionMode.auto",
              })}
            </SelectItem>
            <SelectItem value="plan">
              {intl.formatMessage({
                id: "settings.multiAgent.teamMembers.form.permissionMode.plan",
              })}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 pt-1">
        <FormFieldLabel>
          {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.tools.label" })}
        </FormFieldLabel>
        <Select
          value={inheritAllTools ? "all" : "custom"}
          disabled={saving}
          onValueChange={(next) => setInheritAllTools(next !== "custom")}
        >
          <SelectTrigger size="lg" className="w-fit justify-between">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.tools.all" })}
            </SelectItem>
            <SelectItem value="custom">
              {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.tools.custom" })}
            </SelectItem>
          </SelectContent>
        </Select>
        {inheritAllTools ? null : (
          <div className="rounded-lg border border-border bg-card p-1">
            <div className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {TOOL_OPTIONS.map((tool) => {
                const checked = selectedTools.includes(tool);
                return (
                  <button
                    key={tool}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={saving}
                    onClick={() => toggleTool(tool)}
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-base text-foreground transition-colors hover:bg-hover"
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                      aria-hidden="true"
                    >
                      {checked ? <Check className="size-3" /> : null}
                    </span>
                    <span className="truncate">{tool}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {showError(toolsError)}
      </div>

      <div className="space-y-1.5">
        <FormFieldLabel>
          {intl.formatMessage({ id: "settings.multiAgent.teamMembers.form.systemPrompt.label" })}
        </FormFieldLabel>
        <SettingsFormTextarea
          value={systemPrompt}
          disabled={saving}
          onChange={(event) => setSystemPrompt(event.target.value)}
          rows={5}
          className="max-h-72 min-h-24 resize-y overflow-y-auto text-ui-base"
          placeholder={intl.formatMessage({
            id: "settings.multiAgent.teamMembers.form.systemPrompt.placeholder",
          })}
        />
        {showError(promptError)}
      </div>

      <SettingsFormActions
        leadingAction={
          agent && onDelete ? (
            <Button
              type="button"
              variant="link"
              size="lg"
              className="px-0 text-destructive hover:text-destructive"
              disabled={saving}
              onClick={() => onDelete(agent)}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {intl.formatMessage({ id: "common.delete" })}
            </Button>
          ) : undefined
        }
      >
        <Button type="submit" variant="default" size="lg" disabled={saving}>
          {saving
            ? intl.formatMessage({ id: "common.saving" })
            : intl.formatMessage({ id: "common.save" })}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel} disabled={saving}>
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
      </SettingsFormActions>
    </form>
  );
}
