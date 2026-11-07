import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE } from "@zcode/shared";
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  PanelRightClose,
  PanelRightOpen,
  RotateCw,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { DesktopWindowControls } from "@/DesktopWindowControls.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { displayBrowserUrl } from "@/embeddedBrowserHelpers.js";
import { InstanceStrip } from "@/browser-console/InstanceStrip.js";
import { ConsoleTabStrip } from "@/browser-console/ConsoleTabStrip.js";
import { BrowserConsoleViewport } from "@/browser-console/BrowserConsoleViewport.js";
import { NetworkPanel } from "@/browser-console/NetworkPanel.js";
import { PageInspector } from "@/browser-console/PageInspector.js";
import { useBrowserConsole } from "@/browser-console/useBrowserConsole.js";
import { EmbeddedBrowserPermissionPrompts } from "@/browser-use/EmbeddedBrowserPermissionPrompts.js";
import {
  BrowserConsoleEmptyState,
  resolveBrowserConsoleAddress,
} from "@/browser-console/browserConsoleViewUtils.js";

export function BrowserConsoleView({
  workspaceKey,
  sessionId,
  isVisible,
  isDesktop = true,
  isRemoteWorkspace = false,
  showWindowControls = false,
}: {
  workspaceKey: string;
  sessionId: string | null;
  isVisible: boolean;
  isDesktop?: boolean;
  isRemoteWorkspace?: boolean;
  showWindowControls?: boolean;
}): React.JSX.Element {
  const { intl } = useZCodeIntl();
  const controller = useBrowserConsole({ workspaceKey, sessionId, isVisible });
  const [addressValue, setAddressValue] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState("network");
  const lastReportedRef = useRef(new Map<string, string>());
  const activeTab = controller.activeTab;
  const activeInstance = controller.activeInstance;

  useEffect(() => {
    setAddressValue(displayBrowserUrl(activeTab?.url ?? ""));
  }, [activeTab?.id, activeTab?.url]);

  // 深采集是显式租约：切标签或关闭检查器必须立刻释放，让空闲 detach 重新生效。
  useEffect(() => {
    if (!controller.deepCaptureTabId) return;
    if (
      inspectorOpen &&
      inspectorTab === "network" &&
      controller.deepCaptureTabId === activeTab?.id
    ) {
      return;
    }
    void controller.releaseDeepCapture();
  }, [
    activeTab?.id,
    controller.deepCaptureTabId,
    controller.releaseDeepCapture,
    inspectorOpen,
    inspectorTab,
  ]);

  const webview = activeTab ? controller.getWebview(activeTab.id) : undefined;

  const navigate = useCallback(() => {
    if (!webview) return;
    const url = resolveBrowserConsoleAddress(addressValue);
    if (!url) return;
    void webview.loadURL(url).catch(() => undefined);
  }, [addressValue, webview]);

  const goBack = useCallback(() => {
    try {
      if (webview?.canGoBack()) webview.goBack();
    } catch {
      // guest 尚未 attach。
    }
  }, [webview]);

  const goForward = useCallback(() => {
    try {
      if (webview?.canGoForward()) webview.goForward();
    } catch {
      // guest 尚未 attach。
    }
  }, [webview]);

  const reloadOrStop = useCallback(() => {
    if (!webview) return;
    try {
      if (activeTab?.isLoading) (webview as unknown as { stop?: () => void }).stop?.();
      else webview.reload();
    } catch {
      // guest 尚未 attach。
    }
  }, [activeTab?.isLoading, webview]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) {
        if (event.altKey && event.key === "ArrowLeft") {
          event.preventDefault();
          goBack();
        } else if (event.altKey && event.key === "ArrowRight") {
          event.preventDefault();
          goForward();
        }
        return;
      }
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>("[data-testid='browser-console-address']")
          ?.focus();
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        if (activeInstance) void controller.openTab(activeInstance.id);
      } else if (event.key.toLowerCase() === "w" && activeTab) {
        event.preventDefault();
        void controller.closeTab(activeTab.id);
      } else if (event.key.toLowerCase() === "a" && event.shiftKey) {
        event.preventDefault();
        setInspectorOpen((open) => !open);
      }
    },
    [activeInstance, activeTab, controller, goBack, goForward],
  );

  const tabs = controller.tabs;
  if (!isDesktop) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "browserConsole.notSupported" })}
      </div>
    );
  }
  const instancesById = new Map(controller.instances.map((instance) => [instance.id, instance]));

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
      onKeyDown={handleKeyDown}
      data-testid="browser-console"
    >
      <div
        data-testid="browser-console-toolbar"
        className="flex min-h-12 shrink-0 items-center [app-region:drag]"
        style={{ paddingLeft: "var(--workspace-view-toolbar-inset, 0px)" }}
      >
        <div className="min-w-0 flex-1 [&_button]:[app-region:no-drag]">
          <InstanceStrip
            instances={controller.instances}
            activeInstanceId={controller.activeInstanceId}
            aiControlledInstanceId={controller.agentBindingInstanceId}
            busy={controller.busy}
            onSelect={controller.selectInstance}
            onCreate={controller.createInstance}
            onUpdate={controller.updateInstance}
            onDelete={controller.deleteInstance}
            onClearData={async (instanceId, mode) => {
              await controller.clearInstanceData(instanceId, mode);
            }}
          />
        </div>
        {showWindowControls ? <DesktopWindowControls /> : null}
      </div>
      <ConsoleTabStrip
        tabs={tabs}
        activeTabId={activeTab?.id ?? null}
        maxTabs={MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE}
        onActivate={controller.activateTab}
        onClose={(tabId) => void controller.closeTab(tabId)}
        onNew={() => {
          if (activeInstance) void controller.openTab(activeInstance.id);
        }}
      />

      <div className="flex items-center gap-1 border-b border-border-subtle px-2 py-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={intl.formatMessage({ id: "browserConsole.back" })}
          onClick={goBack}
          disabled={!activeTab?.canGoBack}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={intl.formatMessage({ id: "browserConsole.forward" })}
          onClick={goForward}
          disabled={!activeTab?.canGoForward}
        >
          <ArrowRight className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={intl.formatMessage({
            id: activeTab?.isLoading ? "browserConsole.stop" : "browserConsole.reload",
          })}
          onClick={reloadOrStop}
          disabled={!activeTab}
        >
          {activeTab?.isLoading ? <Square className="size-3" /> : <RotateCw className="size-3.5" />}
        </Button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigate();
          }}
        >
          <Input
            value={addressValue}
            onChange={(event) => setAddressValue(event.currentTarget.value)}
            placeholder={intl.formatMessage({ id: "browserConsole.addressPlaceholder" })}
            aria-label={intl.formatMessage({ id: "browserConsole.address" })}
            data-testid="browser-console-address"
            className="h-7 font-mono text-ui-base"
            spellCheck={false}
          />
        </form>
        <label
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ui-xs",
            isRemoteWorkspace && "opacity-60",
          )}
          title={
            isRemoteWorkspace
              ? intl.formatMessage({ id: "browserConsole.aiControlRemote" })
              : intl.formatMessage({ id: "browserConsole.aiControlHint" })
          }
        >
          <Switch
            checked={controller.aiControlEnabled}
            disabled={!sessionId || isRemoteWorkspace}
            onCheckedChange={(checked) => void controller.setAiControl(checked)}
            aria-label={intl.formatMessage({ id: "browserConsole.aiControl" })}
            data-testid="browser-console-ai-control"
          />
          <span className="whitespace-nowrap">
            {intl.formatMessage({ id: "browserConsole.aiControl" })}
          </span>
        </label>
        <Button
          variant={inspectorOpen ? "secondary" : "ghost"}
          size="icon-sm"
          aria-expanded={inspectorOpen}
          aria-label={intl.formatMessage({
            id: inspectorOpen ? "browserConsole.hideInspector" : "browserConsole.showInspector",
          })}
          onClick={() => setInspectorOpen((open) => !open)}
          data-testid="browser-console-inspector-toggle"
        >
          {inspectorOpen ? (
            <PanelRightClose className="size-3.5" />
          ) : (
            <PanelRightOpen className="size-3.5" />
          )}
        </Button>
      </div>

      {controller.error ? (
        <div
          role="alert"
          className="border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-ui-base text-destructive"
        >
          {controller.error}
        </div>
      ) : null}
      {!sessionId && !isRemoteWorkspace ? (
        <p className="border-b border-border-subtle px-3 py-1 text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "browserConsole.aiControlNoSession" })}
        </p>
      ) : null}
      {isRemoteWorkspace ? (
        <p className="border-b border-border-subtle px-3 py-1 text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "browserConsole.aiControlRemote" })}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <EmbeddedBrowserPermissionPrompts guestWebContentsId={activeTab?.webContentsId} />
        <div className="relative flex min-h-0 flex-1 flex-col">
          {controller.instances.length === 0 ? (
            <BrowserConsoleEmptyState
              title={intl.formatMessage({ id: "browserConsole.emptyInstancesTitle" })}
              body={intl.formatMessage({ id: "browserConsole.emptyInstancesBody" })}
            />
          ) : tabs.length === 0 ? (
            <BrowserConsoleEmptyState
              title={intl.formatMessage({ id: "browserConsole.emptyTabsTitle" })}
              body={intl.formatMessage({ id: "browserConsole.emptyTabsBody" })}
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    if (activeInstance) void controller.openTab(activeInstance.id);
                  }}
                >
                  <Globe className="size-3.5" />
                  {intl.formatMessage({ id: "browserConsole.newTab" })}
                </Button>
              }
            />
          ) : null}
          {tabs.map((tab) => {
            const instance = instancesById.get(tab.instanceId);
            if (!instance || tab.suspended) return null;
            return (
              <BrowserConsoleViewport
                key={`${tab.id}:${tab.generation ?? 0}`}
                tab={tab}
                instance={instance}
                isActive={tab.id === activeTab?.id}
                isVisible={isVisible}
                workspaceKey={workspaceKey}
                sessionId={sessionId}
                aiControlEnabled={
                  controller.aiControlEnabled && tab.instanceId === activeInstance?.id
                }
                lastReportedRef={lastReportedRef}
                onTabPatch={controller.updateTab}
                onWebviewRef={controller.registerWebview}
              />
            );
          })}
        </div>

        {inspectorOpen ? (
          <aside className="flex w-[380px] max-w-[45%] shrink-0 flex-col border-l border-border-subtle bg-surface">
            <Tabs
              value={inspectorTab}
              onValueChange={setInspectorTab}
              className="flex h-full min-h-0 flex-col"
            >
              <TabsList className="mx-2 mt-2 shrink-0">
                <TabsTrigger value="network">
                  {intl.formatMessage({ id: "browserConsole.network" })}
                </TabsTrigger>
                <TabsTrigger value="elements">
                  {intl.formatMessage({ id: "browserConsole.elements" })}
                </TabsTrigger>
                <TabsTrigger value="form">
                  {intl.formatMessage({ id: "browserConsole.form" })}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="network" className="min-h-0 flex-1 overflow-hidden">
                <NetworkPanel
                  entries={controller.networkEntries}
                  dropped={controller.networkDropped}
                  showSensitive={controller.showSensitiveHeaders}
                  deepCaptureEnabled={controller.deepCaptureTabId === activeTab?.id}
                  canDeepCapture={Boolean(activeTab)}
                  onToggleSensitive={() =>
                    controller.setShowSensitiveHeaders(!controller.showSensitiveHeaders)
                  }
                  onClear={() => void controller.clearNetwork()}
                  onExportHar={() => void controller.exportHar()}
                  onToggleDeepCapture={() =>
                    void controller.setDeepCapture(controller.deepCaptureTabId !== activeTab?.id)
                  }
                  onLoadBody={controller.getResponseBody}
                />
              </TabsContent>
              <TabsContent value="elements" className="min-h-0 flex-1 overflow-auto">
                <PageInspector
                  pageSnapshot={controller.pageSnapshot}
                  pickElement={controller.pickElement}
                  applyEdit={controller.applyEdit}
                  fillForm={controller.fillForm}
                  tabId={activeTab?.id ?? null}
                />
              </TabsContent>
              <TabsContent value="form" className="min-h-0 flex-1 overflow-auto">
                <PageInspector
                  pageSnapshot={controller.pageSnapshot}
                  pickElement={controller.pickElement}
                  applyEdit={controller.applyEdit}
                  fillForm={controller.fillForm}
                  tabId={activeTab?.id ?? null}
                  formOnly
                />
              </TabsContent>
            </Tabs>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
