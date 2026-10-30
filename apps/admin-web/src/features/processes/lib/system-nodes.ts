// CR-105 · L3: nút hệ thống của khe app (quy trình thư viện `contracts.approval`) — hiện trên canvas nhưng KHOÁ (không xoá/đổi/di chuyển).
// Khoá theo khoá tool (registry khe ở Hub: `contracts-route` chọn bước kế, `contracts-finalize` ghi "Đã duyệt").

export const SYSTEM_TOOL_KEYS: readonly string[] = ["contracts-route", "contracts-finalize"];

type StageLike = { executor: string; tool: { key: string } };

/** Giai đoạn là nút hệ thống (gọi tool hệ thống của khe) ⇒ canvas/form khoá. */
export const isSystemStage = (s: StageLike): boolean =>
  s.executor === "tool" && SYSTEM_TOOL_KEYS.includes(s.tool.key);

/** `executor.tool_key` của stage engine (dạng đã lưu) là tool hệ thống. */
export const isSystemToolKey = (key: string | null | undefined): boolean =>
  key != null && SYSTEM_TOOL_KEYS.includes(key);
