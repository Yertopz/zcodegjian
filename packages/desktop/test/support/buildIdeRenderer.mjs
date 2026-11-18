import { resolve } from "node:path";
import { build } from "vite";

const desktop = resolve(import.meta.dirname, "../..");
// Vite 配置中的 renderer root 相对工作目录；独立脚本与 pnpm 包入口必须一致。
process.chdir(desktop);
// 始终复用仓库内唯一的验收构建目录，不为每次 Electron 启动复制一份载荷。
await build({
  configFile: resolve(desktop, "vite.config.ts"),
  mode: "development",
  logLevel: "warn",
  build: {
    outDir: resolve(desktop, "../../.local/ide-e2e/renderer"),
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
  },
});
