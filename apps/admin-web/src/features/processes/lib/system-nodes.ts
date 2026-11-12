// CR-105 / CR-127 Z3b: tool hệ thống của khe app do gói cấp (nay chỉ `dlc-step`; `contracts-route`/`contracts-finalize` của máy duyệt cũ đã gỡ).
//  - "nút hệ thống" (khoá) = tool hệ thống KHÔNG mang `slot.kind`; "bước của khe" = stage mang `slot.kind` ⇒ sửa được.

// dlc-engine · `dlc-step`: tool của bước DLC (khe `dlc.*`) — do gói cấp, không có ở catalog tool của tenant.
import { MODULES } from "@ai/contracts/modules";

export const SYSTEM_TOOL_KEYS: readonly string[] = ["dlc-step"];

type StageLike = {
  executor: string;
  tool: { key: string };
  slotRaw?: Record<string, unknown> | undefined;
};

/** Tool do một node của gói/module khai báo (vd `contracts-esign-send`): hub kiểm riêng (validator cấu hình node) ⇒ KHÔNG kiểm theo catalog tool nền tảng. */
const MODULE_TOOL_KEYS: ReadonlySet<string> = new Set<string>(
  MODULES.flatMap((m) => m.nodes).flatMap((n) =>
    (n.stages ?? []).flatMap((st): string[] =>
      st.executor.kind === "tool" ? [String(st.executor.tool_key)] : [],
    ),
  ),
);
export const isModuleToolKey = (key: string): boolean => MODULE_TOOL_KEYS.has(key);

/** Stage gọi tool hệ thống của khe (bước duyệt, route hoặc finalize). */
export const isSystemToolStage = (s: StageLike): boolean =>
  s.executor === "tool" && SYSTEM_TOOL_KEYS.includes(s.tool.key);

/** Stage là một bước người dùng của khe (review / Dify) ⇒ sửa được. */
export const isSlotStep = (s: Pick<StageLike, "slotRaw">): boolean =>
  s.slotRaw?.kind === "review" ||
  s.slotRaw?.kind === "dify" ||
  s.slotRaw?.kind === "dlc" ||
  s.slotRaw?.kind === "notify" || // CR-121 D-6b
  s.slotRaw?.kind === "wait_until";

/** Nút hệ thống khoá trên canvas: `route` / `finalize` (tool hệ thống không phải bước người dùng). */
export const isSystemStage = (s: StageLike): boolean => isSystemToolStage(s) && !isSlotStep(s);

/** `executor.tool_key` của stage engine (dạng đã lưu) là tool hệ thống. */
export const isSystemToolKey = (key: string | null | undefined): boolean =>
  key != null && SYSTEM_TOOL_KEYS.includes(key);

/** Bước duyệt của khe đã có người duyệt theo MÃ phòng ban (`department_group_key`) hoặc người cụ thể — thay cho `after.group_id` (def thư viện không dùng id). */
export const slotHasReviewer = (s: Pick<StageLike, "slotRaw">): boolean => {
  const slot = s.slotRaw;
  // dlc-engine · bước DLC có cổng duyệt ⇒ Group duyệt theo mã ở `slot.gate.group_key`.
  if (slot?.kind === "dlc")
    return typeof (slot.gate as { group_key?: unknown } | null)?.group_key === "string";
  if (slot?.kind !== "review") return false;
  const key = slot.department_group_key;
  return (typeof key === "string" && key !== "") || typeof slot.approver_user_id === "string";
};
