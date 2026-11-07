import { useState } from "react";
import type { FormEvent } from "react";
import { testId, TID_MODEL_PROVIDER_TEMPLATE_PICKER } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 与 Host 侧 `ProviderSettingsCodexLoginInput` 一致：空字符串在提交前被剔除。 */
export interface CodexLoginFormInput {
  authFilePath?: string;
  modelId?: string;
  proxyUrl?: string;
}

/**
 * 「添加供应商 → Codex 登录」的表单。
 *
 * 只收集三项可选输入：凭据文件、默认模型、SK5 代理。真正的写入由 Host 侧的
 * `loginCodex` 完成（读 `~/.codex/auth.json` 与模型缓存，写个人 Provider 配置），
 * 这里不解析、不校验 URL —— 代理格式错误由共享实现统一报错，避免两套规则。
 */
export function CodexLoginForm({
  submitting,
  onSubmit,
  onCancel,
}: {
  submitting: boolean;
  onSubmit: (input: CodexLoginFormInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [authFilePath, setAuthFilePath] = useState("");
  const [modelId, setModelId] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const auth = authFilePath.trim();
    const model = modelId.trim();
    const proxy = proxyUrl.trim();
    void onSubmit({
      ...(auth ? { authFilePath: auth } : {}),
      ...(model ? { modelId: model } : {}),
      // 留空即「不用专属代理」，Host 会显式清掉旧代理回落到全局网络设置。
      ...(proxy ? { proxyUrl: proxy } : {}),
    });
  };

  return (
    <form
      className="space-y-4"
      data-testid={testId(TID_MODEL_PROVIDER_TEMPLATE_PICKER, "codex-login")}
      onSubmit={handleSubmit}
    >
      <p className="text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.modelProvider.codexLoginHint" })}
      </p>
      <div className="space-y-2">
        <Label htmlFor="codex-login-auth-file">
          {intl.formatMessage({ id: "settings.modelProvider.codexAuthFileLabel" })}
        </Label>
        <Input
          id="codex-login-auth-file"
          value={authFilePath}
          placeholder={intl.formatMessage({
            id: "settings.modelProvider.codexAuthFilePlaceholder",
          })}
          data-testid={testId(TID_MODEL_PROVIDER_TEMPLATE_PICKER, "codex-login-auth-file")}
          onChange={(event) => setAuthFilePath(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="codex-login-model">
          {intl.formatMessage({ id: "settings.modelProvider.codexModelLabel" })}
        </Label>
        <Input
          id="codex-login-model"
          value={modelId}
          placeholder={intl.formatMessage({
            id: "settings.modelProvider.codexModelPlaceholder",
          })}
          data-testid={testId(TID_MODEL_PROVIDER_TEMPLATE_PICKER, "codex-login-model")}
          onChange={(event) => setModelId(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="codex-login-proxy">
          {intl.formatMessage({ id: "settings.modelProvider.codexProxyLabel" })}
        </Label>
        <Input
          id="codex-login-proxy"
          value={proxyUrl}
          placeholder={intl.formatMessage({
            id: "settings.modelProvider.codexProxyPlaceholder",
          })}
          data-testid={testId(TID_MODEL_PROVIDER_TEMPLATE_PICKER, "codex-login-proxy")}
          onChange={(event) => setProxyUrl(event.target.value)}
        />
        <p className="text-ui-sm text-foreground-subtlest">
          {intl.formatMessage({ id: "settings.modelProvider.codexProxyHint" })}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
          {intl.formatMessage({ id: "settings.modelProvider.codexLoginCancel" })}
        </Button>
        <Button
          type="submit"
          disabled={submitting}
          data-testid={testId(TID_MODEL_PROVIDER_TEMPLATE_PICKER, "codex-login-submit")}
        >
          {intl.formatMessage({
            id: submitting
              ? "settings.modelProvider.codexLoginSubmitting"
              : "settings.modelProvider.codexLoginSubmit",
          })}
        </Button>
      </div>
    </form>
  );
}
