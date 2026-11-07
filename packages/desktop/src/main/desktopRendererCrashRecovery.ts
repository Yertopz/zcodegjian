export interface DesktopRendererGoneDetails {
  reason: string;
  exitCode: number;
}

interface DesktopRendererCrashRecoveryOptions {
  isWindowDestroyed(): boolean;
  reload(): void;
  logger: {
    warn(message: string, details?: unknown): void;
  };
}

/** 中文注释：仅恢复意外 renderer 崩溃；正常关闭和主动重载不触发恢复。 */
export function createDesktopRendererCrashRecovery(options: DesktopRendererCrashRecoveryOptions) {
  let reloadInFlight = false;

  return {
    onRendererGone(details: DesktopRendererGoneDetails): boolean {
      if (details.reason !== "crashed" && details.reason !== "oom") return false;
      if (options.isWindowDestroyed() || reloadInFlight) return false;

      reloadInFlight = true;
      try {
        options.logger.warn("[desktop-window] renderer crashed; reloading main window", {
          reason: details.reason,
          exitCode: details.exitCode,
        });
        options.reload();
        return true;
      } catch (error) {
        reloadInFlight = false;
        options.logger.warn("[desktop-window] renderer crash recovery reload failed", {
          reason: details.reason,
          exitCode: details.exitCode,
          error,
        });
        return false;
      }
    },
    onLoadFinished(): void {
      reloadInFlight = false;
    },
    onMainFrameLoadFailed(): void {
      reloadInFlight = false;
    },
  };
}
