import { createRoot } from "react-dom/client";
import { useState } from "react";
import {
  appSettingsSchema,
  appSettingsPatchSchema,
  resolveMainAgentPrompt,
  type IPlatformService,
} from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { ServiceProvider } from "../../src/hooks/useServices.js";
import { PlatformProvider } from "../../src/hooks/usePlatform.js";
import { TabStoreProvider } from "../../src/store/TabStoreProvider.js";
import { ZCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";
import { ConfirmDialogHost } from "../../src/ConfirmDialog.js";
import { MainAgentPromptsSection } from "../../src/settings/MainAgentPromptsSection.js";
import { MainAgentPromptSelector } from "../../src/v4/composer/MainAgentPromptSelector.js";

const key = "main-prompt-fixture-settings";
const settings = () => appSettingsSchema.parse(JSON.parse(localStorage.getItem(key) ?? "{}"));
let failSave = false;
let failSwitch = false;
const services = {
  settingService: {
    get: async () => settings(),
    update: async (patch: unknown) => {
      if (failSave) throw new Error("fixture save failure");
      localStorage.setItem(
        key,
        JSON.stringify({ ...settings(), ...appSettingsPatchSchema.parse(patch) }),
      );
    },
  },
} as unknown as IServiceAccessor;

function Harness() {
  const [selectedId, setSelected] = useState<string | null>(() =>
    localStorage.getItem("main-prompt-fixture-selection"),
  );
  const [request, setRequest] = useState("");
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 text-foreground">
      <MainAgentPromptsSection workspacePath="fixture" />
      <div className="rounded-lg border border-border">
        <MainAgentPromptSelector
          workspacePath="fixture"
          selectedId={selectedId}
          onSelect={async (id) => {
            if (failSwitch) throw new Error("fixture switch failure");
            localStorage.setItem("main-prompt-fixture-selection", id ?? "");
            setSelected(id);
          }}
        />
        <button
          data-testid="fixture-send"
          onClick={() => {
            const mainAgentPrompt = resolveMainAgentPrompt(settings().mainAgentPrompts, selectedId);
            void fetch("/system-request", { method: "POST", body: JSON.stringify(mainAgentPrompt) })
              .then((result) => result.text())
              .then(setRequest);
          }}
        >
          发送测试输入
        </button>
      </div>
      <output
        data-testid="fixture-system-request"
        className="block max-h-24 overflow-auto text-ui-caption"
      >
        {request}
      </output>
      <ConfirmDialogHost />
    </main>
  );
}
Object.assign(window, {
  mainAgentPromptsTest: {
    settings,
    failSave(value: boolean) {
      failSave = value;
    },
    failSwitch(value: boolean) {
      failSwitch = value;
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale="zh-CN">
    <ServiceProvider services={services}>
      <PlatformProvider platform={{ kind: "web" } as unknown as IPlatformService}>
        <TabStoreProvider>
          <TooltipProvider>
            <Harness />
          </TooltipProvider>
        </TabStoreProvider>
      </PlatformProvider>
    </ServiceProvider>
  </ZCodeIntlProvider>,
);
