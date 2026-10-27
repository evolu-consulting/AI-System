// CR-101 DOC-deals · luật thuần của Giao dịch là chứng từ (`doc_type = 'deal'`): mốc xác nhận ngay khi lưu (Câu 4), điều kiện nâng
// thành HĐ (R10), ánh xạ lớp tương thích `/transactions` (đọc), mã lỗi DB → mã API. Tái dùng luật mốc V2-A (`milestones.rules.ts`);
// `transactions.rules.ts` (G1) đóng băng. Lớp 1: không I/O.

export type DealMilestone = { id: string; kind: string; status: string };

/** Câu 4 · ô "Đã giao / đã thanh toán ngay": xác nhận mọi mốc mặc định còn mở — giao trước (kho) rồi tiền/hoa hồng. */
export function settleNowOrder(ms: readonly DealMilestone[]): string[] {
  const rank = (k: string) =>
    k === "delivery" ? 0 : k === "payment" || k === "commission" ? 1 : 9;
  return ms
    .filter((m) => m.status === "open" && rank(m.kind) < 9)
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .map((m) => m.id);
}

export type PromoteVerdict = "ok" | "not_deal" | "superseded";

/** R10: chỉ giao dịch hiện hành mới nâng được (file ký + số HĐ kiểm ở schema + trigger DB). */
export function promoteVerdict(c: { doc_type: string; superseded: boolean }): PromoteVerdict {
  if (c.doc_type !== "deal") return "not_deal";
  return c.superseded ? "superseded" : "ok";
}

/** Lớp tương thích G1 (đọc): giao dịch bị huỷ khi chuyển = `rejected`; còn lại là "đã ghi sổ" (lưu là có hiệu lực). */
export const legacyStatus = (status: string): "posted" | "cancelled" =>
  status === "rejected" ? "cancelled" : "posted";

const DB_CODES = new Set([
  "PROMOTE_INVALID",
  "PROMOTE_NEEDS_FILE",
  "PROMOTE_NEEDS_NUMBER",
  "USE_CONTRACTS",
]);

/** Lỗi DB của 0056 (`EK422`/`EG410` + message = mã) ⇒ mã API; khác ⇒ null. */
export function dealDbCode(e: unknown): string | null {
  const o = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const pg = o?.cause?.code ? o.cause : o;
  if (pg?.code !== "EK422" && pg?.code !== "EG410") return null;
  const m = pg.message ?? "";
  return DB_CODES.has(m) ? (m === "PROMOTE_INVALID" ? "NOT_A_DEAL" : m) : null;
}
