// CR-105: nút hệ thống của khe app (quy trình thư viện `contracts.approval`).
// Hub biên dịch MỖI bước duyệt thành một stage gọi tool `contracts-route` (kèm cổng review) ⇒ không thể khoá theo khoá tool:
//  - "tool hệ thống" = stage gọi `contracts-route`/`contracts-finalize` (không kiểm theo catalog tool của tenant — tool do gói/khe cấp, không có ở catalog nền tảng);
//  - "nút hệ thống" (khoá: không xoá/đổi/kéo) = tool hệ thống KHÔNG mang `slot.kind` ⇒ chỉ stage `route` và `finalize`;
//  - "bước của khe" = stage mang `slot.kind` review/dify ⇒ sửa được (form theo mã phòng ban), Hub dựng lại `slot_body` từ `stages`.

export const SYSTEM_TOOL_KEYS: readonly string[] = ["contracts-route", "contracts-finalize"];

type StageLike = {
  executor: string;
  tool: { key: string };
  slotRaw?: Record<string, unknown> | undefined;
};

/** Stage gọi tool hệ thống của khe (bước duyệt, route hoặc finalize). */
export const isSystemToolStage = (s: StageLike): boolean =>
  s.executor === "tool" && SYSTEM_TOOL_KEYS.includes(s.tool.key);

/** Stage là một bước người dùng của khe (review / Dify) ⇒ sửa được. */
export const isSlotStep = (s: Pick<StageLike, "slotRaw">): boolean =>
  s.slotRaw?.kind === "review" || s.slotRaw?.kind === "dify";

/** Nút hệ thống khoá trên canvas: `route` / `finalize` (tool hệ thống không phải bước người dùng). */
export const isSystemStage = (s: StageLike): boolean => isSystemToolStage(s) && !isSlotStep(s);

/** `executor.tool_key` của stage engine (dạng đã lưu) là tool hệ thống. */
export const isSystemToolKey = (key: string | null | undefined): boolean =>
  key != null && SYSTEM_TOOL_KEYS.includes(key);

/** Bước duyệt của khe đã có người duyệt theo MÃ phòng ban (`department_group_key`) hoặc người cụ thể — thay cho `after.group_id` (def thư viện không dùng id). */
export const slotHasReviewer = (s: Pick<StageLike, "slotRaw">): boolean => {
  const slot = s.slotRaw;
  if (slot?.kind !== "review") return false;
  const key = slot.department_group_key;
  return (typeof key === "string" && key !== "") || typeof slot.approver_user_id === "string";
};
