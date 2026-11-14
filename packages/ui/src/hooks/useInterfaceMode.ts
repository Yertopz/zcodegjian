import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";

export function useIsOfficeMode(): boolean {
  return useZCodeStoreWithDefault((state) => state.interfaceMode === "office", false);
}

/** IDE 模式（docs/development/187-ide-mode.md）：主区替换为代码工作台。 */
export function useIsIdeMode(): boolean {
  return useZCodeStoreWithDefault((state) => state.interfaceMode === "ide", false);
}
