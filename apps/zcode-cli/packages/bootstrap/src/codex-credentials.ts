/**
 * CLI 侧的 Codex 凭据入口。
 *
 * 读取逻辑（`~/.codex/auth.json`、`~/.codex/models_cache.json`）在 `@zcode/provider-node`
 * 与桌面端共用同一份实现；这里只做同名转发，保持 `@zcode/bootstrap` 的导出形状不变。
 */
export * from "@zcode/provider-node";
