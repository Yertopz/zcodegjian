import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ZCODE_AGENT_PROVIDER, testId, type AgentSummary } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useModelSelectionServiceView } from "@/hooks/useModelSelectionView.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { buildRegistryModelSelectGroups } from "@/lib/modelSelectionGroups.js";
import { PluginInstallEmptyState, PluginLoadingState } from "@/settings/PluginInstallEmptyState.js";
import { SettingsResourceGroupHeader } from "@/settings/SettingsResourceGroupHeader.js";
import { SettingsResourceHeaderActions } from "@/settings/SettingsResourceHeaderActions.js";
import { TeamMemberAvatar } from "@/components/team/TeamMemberAvatar.js";
import { TeamMemberForm, type TeamMemberFormSubmit } from "@/settings/TeamMemberForm.js";
import { refreshLoadedSubagentsStoreForWorkspace } from "@/store/subagentsStore.js";

const TID_TEAM_MEMBER_ROW = "settings-team-member-row";

/**
 * 「团队成员」设置分区。
 *
 * 与 `SubagentsSection` 分开维护是刻意的：团队成员写在 `~/.zcode/agents/*.md` 且带 `kind: team`，
 * 在 `@` 面板里走独立的提及分组（`team-member:` 前缀）。两个页面各自只有一条写入路径，
 * 避免同一条记录在两处表单里被交叉改写。
 *
 * 头像存在 `agents-state.json#agentAvatars`，键是 agent id；而 id 由文件名推导，
 * 改名时才会变。因此写入顺序固定为「先落配置文件、拿到返回的 agent、再写头像」，
 * 否则改名后头像会挂在旧 id 上成为孤儿。
 */
export function TeamMembersSection({ workspacePath }: { workspacePath?: string | null }) {
  const { intl } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const { subagentsService, modelSelectionService } = useBaseWorkspaceServices();
  const modelSelectionRead = useModelSelectionServiceView(modelSelectionService);
  const modelSelectionView =
    modelSelectionRead.state.status === "ready" ? modelSelectionRead.state.view : null;

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [operatingAgentId, setOperatingAgentId] = useState<string | null>(null);
  const latestRequestIdRef = useRef(0);

  const targetWorkspacePath = workspacePath ?? "";

  const modelGroups = useMemo(() => {
    if (!modelSelectionView) return [];
    return buildRegistryModelSelectGroups(ZCODE_AGENT_PROVIDER, modelSelectionView);
  }, [modelSelectionView]);

  const loadAgents = useCallback(
    async (showBlockingLoading: boolean) => {
      if (showBlockingLoading) setLoading(true);
      setError(null);
      const requestId = ++latestRequestIdRef.current;
      try {
        const result = await subagentsService.list({
          workspacePath: targetWorkspacePath,
          provider: ZCODE_AGENT_PROVIDER,
          mode: "allRuntimeScopes",
        });
        if (requestId !== latestRequestIdRef.current) return;
        setAgents(result.agents.filter((agent) => agent.kind === "team"));
      } catch (loadError) {
        if (requestId !== latestRequestIdRef.current) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (requestId === latestRequestIdRef.current) setLoading(false);
      }
    },
    [subagentsService, targetWorkspacePath],
  );

  useEffect(() => {
    void loadAgents(true);
  }, [loadAgents]);

  const refresh = useCallback(async () => {
    await loadAgents(false);
  }, [loadAgents]);

  const refreshMentionStore = useCallback(async () => {
    await refreshLoadedSubagentsStoreForWorkspace({
      workspacePath: targetWorkspacePath,
      subagentsService,
    });
  }, [subagentsService, targetWorkspacePath]);

  const handleSubmit = useCallback(
    async ({ config, avatar }: TeamMemberFormSubmit) => {
      setSaving(true);
      try {
        const written = editingAgent
          ? await subagentsService.updateAgent({
              agentId: editingAgent.id,
              config,
              oldFilePath: editingAgent.path,
              provider: ZCODE_AGENT_PROVIDER,
              scope: editingAgent.scope === "workspace" ? "workspace" : "user",
              workspacePath: editingAgent.projectPath ?? (targetWorkspacePath || undefined),
            })
          : await subagentsService.createAgent({
              config,
              provider: ZCODE_AGENT_PROVIDER,
              scope: "user",
              workspacePath: targetWorkspacePath || undefined,
            });
        await subagentsService.setAgentAvatar({ agentId: written.agent.id, avatar });
        setShowForm(false);
        setEditingAgent(null);
        await Promise.all([refresh(), refreshMentionStore()]);
      } catch (saveError) {
        logger.warn("[settings] 保存团队成员失败", { error: String(saveError) });
        toast(
          intl.formatMessage(
            { id: "settings.multiAgent.teamMembers.saveFailed" },
            {
              message: saveError instanceof Error ? saveError.message : String(saveError),
            },
          ),
        );
      } finally {
        setSaving(false);
      }
    },
    [editingAgent, intl, refresh, refreshMentionStore, subagentsService, targetWorkspacePath],
  );

  const handleDelete = useCallback(
    async (agent: AgentSummary) => {
      const confirmed = await confirmDialog({
        title: intl.formatMessage({ id: "settings.multiAgent.teamMembers.delete.title" }),
        description: intl.formatMessage(
          { id: "settings.multiAgent.teamMembers.delete.description" },
          { name: agent.name },
        ),
        confirmLabel: intl.formatMessage({ id: "common.delete" }),
      });
      if (!confirmed) return;
      setOperatingAgentId(agent.id);
      try {
        await subagentsService.deleteAgent({ agentId: agent.id, filePath: agent.path });
        setEditingAgent(null);
        setShowForm(false);
        await Promise.all([refresh(), refreshMentionStore()]);
      } catch (deleteError) {
        toast(deleteError instanceof Error ? deleteError.message : String(deleteError));
      } finally {
        setOperatingAgentId(null);
      }
    },
    [confirmDialog, intl, refresh, refreshMentionStore, subagentsService],
  );

  const handleToggle = useCallback(
    async (agent: AgentSummary, enabled: boolean) => {
      setOperatingAgentId(agent.id);
      try {
        await subagentsService.setEnabled({ agentId: agent.id, enabled });
        await Promise.all([refresh(), refreshMentionStore()]);
      } catch (toggleError) {
        toast(toggleError instanceof Error ? toggleError.message : String(toggleError));
      } finally {
        setOperatingAgentId(null);
      }
    },
    [refresh, refreshMentionStore, subagentsService],
  );

  const handleAddNew = useCallback(() => {
    setEditingAgent(null);
    setShowForm(true);
  }, []);

  const handleCancelForm = useCallback(() => {
    setEditingAgent(null);
    setShowForm(false);
  }, []);

  const currentEditingAgent = useMemo(() => {
    if (!editingAgent) return null;
    return agents.find((agent) => agent.id === editingAgent.id) ?? editingAgent;
  }, [agents, editingAgent]);

  if (showForm || currentEditingAgent !== null) {
    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-ui-xl font-semibold text-foreground">
            {intl.formatMessage({
              id: currentEditingAgent
                ? "settings.multiAgent.teamMembers.edit"
                : "settings.multiAgent.teamMembers.add",
            })}
          </h3>
          <p className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({
              id: currentEditingAgent
                ? "settings.multiAgent.teamMembers.editDescription"
                : "settings.multiAgent.teamMembers.addDescription",
            })}
          </p>
        </div>
        <TeamMemberForm
          agent={currentEditingAgent}
          modelGroups={modelGroups}
          saving={saving}
          onSubmit={handleSubmit}
          onCancel={handleCancelForm}
          onDelete={handleDelete}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SettingsResourceGroupHeader
          count={agents.length}
          title={intl.formatMessage({ id: "settings.multiAgent.teamMembers.title" })}
        />
        <SettingsResourceHeaderActions
          onRefresh={() => void Promise.all([refresh(), refreshMentionStore()])}
          onNew={handleAddNew}
          refreshing={loading}
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-base text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <PluginLoadingState label={intl.formatMessage({ id: "common.loading" })} />
      ) : agents.length === 0 ? (
        <PluginInstallEmptyState
          title={intl.formatMessage({ id: "settings.multiAgent.teamMembers.empty" })}
          description={intl.formatMessage({
            id: "settings.multiAgent.teamMembers.addDescription",
          })}
          actions={
            <Button type="button" variant="default" size="lg" onClick={handleAddNew}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.create.action" })}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const isOperating = operatingAgentId === agent.id;
            const editable = !isOperating && !agent.readOnly;
            return (
              <div
                key={agent.id}
                data-testid={testId(TID_TEAM_MEMBER_ROW, agent.name)}
                className={cn(
                  "flex min-w-0 cursor-default flex-col items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors",
                  editable && "hover:bg-hover",
                )}
              >
                <TeamMemberAvatar
                  name={agent.name}
                  avatar={agent.avatar}
                  color={agent.color}
                  size="lg"
                />
                <div className="w-full min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-ui-base font-medium text-foreground">
                      {agent.name}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-ui-sm text-foreground-subtle">
                    {agent.description ||
                      intl.formatMessage({ id: "settings.subagents.noDescription" })}
                  </p>
                </div>
                <div className="mt-auto flex w-full min-w-0 flex-wrap items-center justify-end gap-2">
                  {agent.scope === "user" ? (
                    <Switch
                      checked={agent.enabled}
                      disabled={isOperating}
                      onCheckedChange={(enabled) => void handleToggle(agent, enabled)}
                      aria-label={intl.formatMessage(
                        { id: "settings.multiAgent.teamMembers.enabled.label" },
                        { name: agent.name },
                      )}
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-md"
                    disabled={!editable}
                    title={intl.formatMessage({ id: "settings.multiAgent.teamMembers.edit" })}
                    onClick={() => {
                      setEditingAgent(agent);
                      setShowForm(false);
                    }}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-md"
                    disabled={!editable}
                    title={intl.formatMessage({ id: "common.delete" })}
                    onClick={() => void handleDelete(agent)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
