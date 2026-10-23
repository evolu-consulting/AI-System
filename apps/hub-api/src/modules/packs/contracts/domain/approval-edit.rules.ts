// Review HD3 S1 (hard stop) · HD-FR-33/34: sửa trường không được lách duyệt cấp 2. Thuần (lớp 1).
// - HĐ đang trong flow (run chưa kết thúc) đã qua cấp 1 ⇒ trường vào rẽ nhánh (`total_value`) bị khoá ⇒ `in_approval` (409).
//   Ở cấp 1 (stage trích/kiểm) vẫn sửa được: rẽ nhánh đọc giá trị SAU cấp 1 (D3-02) — `allowLevel1` để điều phối đổi nếu cần.
// - CR-097 K1 (HD-FR-100): HĐ đã duyệt KHÔNG còn tự mở lại duyệt khi sửa trường tiền/bên (D3-13 bỏ) — khoá cứng do `lock.rules`
//   quyết TRƯỚC luật này; muốn sửa thì owner "Mở lại" (HD-FR-104).

export const BRANCH_FIELDS: ReadonlySet<string> = new Set(["total_value"]);
/** Trạng thái sau "Đã duyệt" (theo dõi hạn HD4). */
export const CONFIRMED_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "expiring",
  "expired",
  "renewed",
  "terminated",
]);
export const FLOW_STATUSES: ReadonlySet<string> = new Set([
  "extracting",
  "extract_failed",
  "needs_review",
]);

export type ApprovalEditPolicy = { allowLevel1: boolean };
export const DEFAULT_EDIT_POLICY: ApprovalEditPolicy = { allowLevel1: true };

/** Giai đoạn run của HĐ: không có / đã kết thúc ⇒ `none`; ở stage cấp 1 ⇒ `level1`; còn lại ⇒ `later`. */
export type RunPhase = "none" | "level1" | "later";
export type EditVerdict = "ok" | "in_approval";

/** Có cần hỏi engine giai đoạn run không (tránh 1 câu thừa khi không đổi trường rẽ nhánh). */
export const needsRunPhase = (status: string, hasRun: boolean, changed: readonly string[]) =>
  hasRun && FLOW_STATUSES.has(status) && changed.some((k) => BRANCH_FIELDS.has(k));

export function editVerdict(i: {
  status: string;
  changed: readonly string[];
  phase: RunPhase;
  policy: ApprovalEditPolicy;
}): EditVerdict {
  if (!FLOW_STATUSES.has(i.status) || !i.changed.some((k) => BRANCH_FIELDS.has(k))) return "ok";
  if (i.phase === "none") return "ok";
  if (i.phase === "level1" && i.policy.allowLevel1) return "ok";
  return "in_approval";
}
