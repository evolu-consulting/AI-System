// CR-157 · luật thuần: nhập tay là dự phòng khi AI đọc lỗi/hết giờ; HĐ nhập tay phải được người nhập xác nhận "đã đối chiếu với tệp gốc".
export type ManualFacts = { status: string; extractState: string };
export type ManualStart = "ok" | "busy" | "not_allowed";

/** Chuyển sang nhập tay chỉ khi HĐ DRAFT và AI đã LỖI (kể cả hết giờ). AI đang đọc ⇒ `busy`; còn lại ⇒ `not_allowed`. */
export function canStartManual(f: ManualFacts): ManualStart {
  if (f.status !== "draft") return "not_allowed";
  if (f.extractState === "reading") return "busy";
  return f.extractState === "failed" ? "ok" : "not_allowed";
}

/** HĐ nhập tay mà chưa có `reconciled_at` ⇒ chặn Lưu/Gửi duyệt (`RECONCILE_REQUIRED`). */
export function needsReconcile(f: { entrySource: string; reconciledAt: string | null }): boolean {
  return f.entrySource === "manual" && f.reconciledAt === null;
}

/** Xác nhận đối chiếu: HĐ nhập tay còn DRAFT; chỉ người tạo ∪ phụ trách (người đang nhập) — ghi chính người gọi. */
export function canReconcile(
  f: { entrySource: string; status: string; createdBy: string; ownerId?: string | null },
  actor: string,
): "ok" | "forbidden" | "not_manual" {
  if (f.createdBy !== actor && f.ownerId !== actor) return "forbidden";
  return f.entrySource === "manual" && f.status === "draft" ? "ok" : "not_manual";
}
