import { useState } from "react";
import { mainAgentPromptSchema, uuidv7, type MainAgentPrompt } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useMainAgentPrompts } from "@/hooks/useMainAgentPrompts.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsFormTextarea } from "./SettingsFormTextarea.js";
import { SettingsFormActions } from "./SettingsFormActions.js";

export function MainAgentPromptsSection({
  workspacePath,
  workspaceIdentity,
}: {
  workspacePath?: string | null;
  workspaceIdentity?: string | null;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.mainAgentPrompts.${key}` });
  const { library, loading, error, save, refresh } = useMainAgentPrompts(
    workspacePath,
    workspaceIdentity,
  );
  const confirm = useConfirmDialog();
  const [draft, setDraft] = useState<MainAgentPrompt | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function persist(action: () => Promise<void>) {
    setSaving(true);
    setFailure(null);
    try {
      await action();
    } catch (cause) {
      setFailure(`${t("saveError")} ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (!library || !draft) return;
    const parsed = mainAgentPromptSchema.safeParse(draft);
    if (!parsed.success) {
      setFailure(t("validation"));
      return;
    }
    await persist(async () => {
      const exists = library.prompts.some((item) => item.id === parsed.data.id);
      await save({
        ...library,
        prompts: exists
          ? library.prompts.map((item) => (item.id === parsed.data.id ? parsed.data : item))
          : [...library.prompts, parsed.data],
      });
      setDraft(null);
    });
  }

  async function remove(item: MainAgentPrompt) {
    if (
      !library ||
      !(await confirm({
        title: t("deleteTitle"),
        testId: "main-agent-prompt-delete-confirm",
        description: t("deleteDescription"),
        confirmLabel: t("delete"),
        confirmVariant: "destructive",
      }))
    )
      return;
    await persist(async () => {
      await save({
        ...library,
        prompts: library.prompts.filter((prompt) => prompt.id !== item.id),
        defaultId: library.defaultId === item.id ? null : library.defaultId,
      });
      if (draft?.id === item.id) setDraft(null);
    });
  }

  return (
    <section className="space-y-4" data-testid="main-agent-prompts-settings">
      <p className="text-ui-base text-foreground-subtle">{t("description")}</p>
      {failure || error ? (
        <div role="alert" className="text-ui-base text-destructive">
          {failure ?? t("loadError")}
          <Button variant="ghost" onClick={() => void refresh()}>
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {loading && !library ? <p className="text-ui-base">{t("loading")}</p> : null}
      {library ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-ui-base">
              {t("newSessionDefault")}
              <select
                data-testid="main-agent-prompts-default"
                className="max-w-64 rounded-lg border border-input-border bg-input px-2 py-1 text-ui-base"
                disabled={saving}
                value={
                  library.prompts.some((item) => item.id === library.defaultId)
                    ? library.defaultId!
                    : ""
                }
                onChange={(event) => {
                  const defaultId = event.target.value || null;
                  void persist(() => save({ ...library, defaultId }));
                }}
              >
                <option value="">{t("default")}</option>
                {library.prompts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              data-testid="main-agent-prompts-add"
              disabled={saving || draft !== null || library.prompts.length >= 100}
              onClick={() => {
                setFailure(null);
                setDraft({ id: uuidv7(), name: "", description: "", prompt: "", appendPrompt: "" });
              }}
            >
              {t("add")}
            </Button>
          </div>
          <div className="rounded-lg border border-border p-3 text-ui-base">
            <span className="font-medium">{t("default")}</span>
            <p className="text-foreground-subtle">{t("defaultDescription")}</p>
          </div>
          {library.prompts.map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-ui-base font-medium">{item.name}</p>
                <p className="break-words text-ui-caption text-foreground-subtle">
                  {item.description}
                </p>
              </div>
              <Button
                variant="ghost"
                disabled={saving || draft !== null}
                onClick={() => {
                  setFailure(null);
                  setDraft({ ...item });
                }}
              >
                {t("edit")}
              </Button>
              <Button variant="ghost" disabled={saving} onClick={() => void remove(item)}>
                {t("delete")}
              </Button>
            </div>
          ))}
          {draft ? (
            <form
              className="space-y-3 rounded-lg border border-border p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void saveDraft();
              }}
            >
              <label className="block space-y-1 text-ui-base">
                {t("name")}
                <Input
                  data-testid="main-agent-prompt-name"
                  required
                  maxLength={100}
                  value={draft.name}
                  disabled={saving}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label className="block space-y-1 text-ui-base">
                {t("summary")}
                <Input
                  data-testid="main-agent-prompt-description"
                  maxLength={500}
                  value={draft.description}
                  disabled={saving}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </label>
              <label className="block space-y-1 text-ui-base">
                {t("body")}
                <SettingsFormTextarea
                  data-testid="main-agent-prompt-body"
                  required
                  rows={10}
                  maxLength={50000}
                  value={draft.prompt}
                  disabled={saving}
                  onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                />
              </label>
              {/* 追加提示词：正文之外单独一块，保存后由 composeMainAgentPromptText
                  拼在正文下一段。分开存是为了再次编辑时还能分别改，不会互相覆盖。 */}
              <label className="block space-y-1 text-ui-base">
                {t("append")}
                <SettingsFormTextarea
                  data-testid="main-agent-prompt-append"
                  rows={4}
                  maxLength={50000}
                  value={draft.appendPrompt ?? ""}
                  disabled={saving}
                  onChange={(event) => setDraft({ ...draft, appendPrompt: event.target.value })}
                />
                <span className="block text-ui-caption text-foreground-subtle">
                  {t("appendHint")}
                </span>
              </label>
              <SettingsFormActions>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setDraft(null)}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={saving} data-testid="main-agent-prompt-save">
                  {t("save")}
                </Button>
              </SettingsFormActions>
            </form>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
