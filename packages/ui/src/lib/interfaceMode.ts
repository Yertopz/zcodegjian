export type InterfaceMode = "office" | "coding" | "ide";

export const INTERFACE_MODE_STORAGE_KEY = "zcode-interface-mode";

export function normalizeInterfaceMode(value: unknown): InterfaceMode {
  // localStorage（zcode-interface-mode）里可能还存着改名前的旧值 "general"/"concise"，
  // 必须映射到新名 office，否则这些存量用户升级后会被归一成 coding，静默丢失选择。
  // "ide" 是 IDE 模式（docs/development/187-ide-mode.md），非法值一律归一为 coding。
  return value === "office" || value === "general" || value === "concise"
    ? "office"
    : value === "ide"
      ? "ide"
      : "coding";
}
