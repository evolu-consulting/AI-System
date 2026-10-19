// F1 (CR-095) · cờ build `PUBLIC_FROZEN_MODULES=on|off` (mặc định off): UI của module đóng băng (docs/platform/modules.md) ẩn khỏi nav và route redirect.
export const frozenModulesOn: boolean = import.meta.env.PUBLIC_FROZEN_MODULES === "on";
