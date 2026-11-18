import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const execute = promisify(execFile);

// 直接启动并用 CDP 驱动真实 Electron，不要求注入或接管主进程调试器。
// 保留同一个 renderer/Host/FileService 链路，不在测试里替代任何文件读写。
export async function launchIdeElectron({ args, cwd, env }) {
  const child = spawn(require("electron"), ["--remote-debugging-port=0", ...args], {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  let browser;
  async function close() {
    await browser?.close().catch(() => {});
    if (child.exitCode === null && child.pid) {
      // 只清理本次启动的进程树，避免后台 Host 留下临时目录句柄。
      if (process.platform === "win32") {
        await execute("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        }).catch(() => {});
      } else child.kill("SIGTERM");
    }
  }
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Electron CDP startup timed out: " + log)),
        90000,
      );
      const fail = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      child.once("error", fail);
      child.once("exit", (code) => fail(Error(`Electron exited (${code}): ${log}`)));
      const collect = (data) => {
        log = (log + data.toString()).slice(-200000);
        const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
    });
    browser = await chromium.connectOverCDP(endpoint);
    return {
      async firstWindow({ timeout = 90000 } = {}) {
        const context = browser.contexts()[0];
        return context.pages()[0] ?? (await context.waitForEvent("page", { timeout }));
      },
      close,
      getLog: () => log,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
