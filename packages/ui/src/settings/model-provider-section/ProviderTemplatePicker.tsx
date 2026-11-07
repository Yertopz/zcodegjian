import type { ProviderSettingsView } from "@zcode/services";
import { ArrowLeftIcon, ChevronRightIcon, KeyRoundIcon, PlusIcon } from "lucide-react";
import { resolveProviderTemplateName } from "@zcode/provider";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  TID_MODEL_PROVIDER_TEMPLATE_BACK_BUTTON,
  TID_MODEL_PROVIDER_TEMPLATE_ITEM,
  TID_MODEL_PROVIDER_TEMPLATE_PICKER,
  testId,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { ProviderLogo } from "./ProviderLogo.js";
import { CodexLoginForm } from "./CodexLoginForm.js";
import type { CodexLoginFormInput } from "./CodexLoginForm.js";
import { useProviderDetailFeedback } from "./ProviderDetailFeedback.js";

type ProviderTemplateCreate = (templateId: string) => Promise<void>;
type CustomProviderCreate = (label: string) => Promise<void>;
type CodexLogin = (input: CodexLoginFormInput) => Promise<void>;

export function ProviderTemplatePicker({
  templates,
  onBack,
  onCreateFromTemplate,
  onCreateCustom,
  onCodexLogin,
  creating,
}: {
  templates: ProviderSettingsView["providerTemplates"];
  onBack: () => void;
  onCreateFromTemplate: ProviderTemplateCreate;
  onCreateCustom: CustomProviderCreate;
  /** 读取本机 Codex 凭据并写入个人 Provider；代理随该连接一起落盘。 */
  onCodexLogin: CodexLogin;
  creating: boolean;
}) {
  const { intl, locale } = useZCodeIntl();
  const { dismissFeedback, showFeedback } = useProviderDetailFeedback();
  const [codexLoginOpen, setCodexLoginOpen] = useState(false);
  const [codexLoginSubmitting, setCodexLoginSubmitting] = useState(false);
  const customLabel = intl.formatMessage({ id: "settings.modelProvider.newProviderName" });
  // 智谱系模板（BigModel / Z.ai API 行）不再出现在模板网格里：这些连接在供应商列表的
  // 订阅入口维护，重复摆一份只会让「添加供应商」多出同义选项。内置发行包随时会刷新
  // templateRules，所以过滤写在消费侧，不依赖远端目录不再下发这几个 id。
  const hiddenTemplateIds = [
    "bigmodel-api",
    "zai-api",
    "bigmodel-standard-api",
    "zai-standard-api",
  ];
  const visibleTemplates = templates.filter(
    (template) => !hiddenTemplateIds.includes(template.templateId),
  );
  const createWithFeedback = async (
    create: () => Promise<void>,
    feedbackKey = "provider-template-create",
    failureMessageId = "settings.modelProvider.templateCreateFailed",
  ) => {
    dismissFeedback(feedbackKey);
    try {
      await create();
    } catch (error) {
      // Template 创建失败过去只写日志，用户留在选择页却看不到任何结果。
      // 失败继续留在当前页，并复用详情栏底部反馈横幅提供同一次创建的重试入口。
      // 完整 Schema issues 只进入统一 UI 日志；横幅保持可读摘要，避免原始数组撑满详情区。
      logger.error("[ProviderTemplatePicker] 创建供应商失败", error);
      const retry = () => void createWithFeedback(create, feedbackKey, failureMessageId);
      // 横幅过去只显示固定的 i18n 文案，把真实原因（凭据格式、代理端口、配置 schema）
      // 全丢掉，用户只能靠猜。错误自带 message 时改用 `<id>.reason` 把原因带上。
      const reason = error instanceof Error ? error.message.trim() : "";
      showFeedback({
        key: feedbackKey,
        state: "failure",
        message: reason
          ? intl.formatMessage({ id: `${failureMessageId}.reason` }, { error: reason })
          : intl.formatMessage({ id: failureMessageId }),
        actionLabel: intl.formatMessage({ id: "settings.modelProvider.templateCreateRetry" }),
        onAction: retry,
        dismissible: true,
      });
    }
  };
  const submitCodexLogin = async (input: CodexLoginFormInput) => {
    setCodexLoginSubmitting(true);
    try {
      await createWithFeedback(
        () => onCodexLogin(input),
        "provider-codex-login",
        "settings.modelProvider.codexLoginFailed",
      );
    } finally {
      setCodexLoginSubmitting(false);
    }
  };
  return (
    <section className="space-y-5" data-testid={TID_MODEL_PROVIDER_TEMPLATE_PICKER}>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-testid={TID_MODEL_PROVIDER_TEMPLATE_BACK_BUTTON}
          aria-label={intl.formatMessage({ id: "settings.modelProvider.templatePickerBack" })}
          onClick={codexLoginOpen ? () => setCodexLoginOpen(false) : onBack}
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
        </Button>
        <h2 className="text-ui-lg font-semibold text-foreground">
          {intl.formatMessage({
            id: codexLoginOpen
              ? "settings.modelProvider.codexLoginTitle"
              : "settings.modelProvider.templatePickerTitle",
          })}
        </h2>
      </div>

      {codexLoginOpen ? (
        <CodexLoginForm
          submitting={codexLoginSubmitting}
          onSubmit={submitCodexLogin}
          onCancel={() => setCodexLoginOpen(false)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ProviderTemplateCard
            label={intl.formatMessage({ id: "settings.modelProvider.codexLogin" })}
            disabled={creating || codexLoginSubmitting}
            testId={testId(TID_MODEL_PROVIDER_TEMPLATE_ITEM, "codex-login")}
            icon={
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover">
                <KeyRoundIcon className="size-4" aria-hidden="true" />
              </span>
            }
            onClick={() => setCodexLoginOpen(true)}
          />
          <ProviderTemplateCard
            label={intl.formatMessage({
              id: "settings.modelProvider.createCustomProvider",
            })}
            disabled={creating}
            testId={testId(TID_MODEL_PROVIDER_TEMPLATE_ITEM, "custom")}
            icon={
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover">
                <PlusIcon className="size-4" aria-hidden="true" />
              </span>
            }
            onClick={() => void createWithFeedback(() => onCreateCustom(customLabel))}
          />
          {visibleTemplates.map((template) => {
            const label = resolveProviderTemplateName(template.templateId, template, locale);
            return (
              <ProviderTemplateCard
                key={template.templateId}
                label={label}
                disabled={creating}
                testId={testId(TID_MODEL_PROVIDER_TEMPLATE_ITEM, template.templateId)}
                icon={
                  <span className="flex size-9 shrink-0 items-center justify-center">
                    <ProviderLogo logo={template.config.logo} className="size-8" />
                  </span>
                }
                onClick={() =>
                  void createWithFeedback(() => onCreateFromTemplate(template.templateId))
                }
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProviderTemplateCard({
  label,
  disabled,
  testId: cardTestId,
  icon,
  onClick,
}: {
  label: string;
  disabled: boolean;
  testId: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <ControlHintTooltip title={label}>
      <button
        type="button"
        data-testid={cardTestId}
        disabled={disabled}
        onClick={onClick}
        className="flex min-h-16 min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors outline-none hover:border-border-hover hover:bg-hover focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60"
      >
        {icon}
        <span className="min-w-0 flex-1 break-words text-ui-base font-medium">{label}</span>
        <ChevronRightIcon className="size-4 shrink-0 text-foreground-subtlest" aria-hidden="true" />
      </button>
    </ControlHintTooltip>
  );
}
