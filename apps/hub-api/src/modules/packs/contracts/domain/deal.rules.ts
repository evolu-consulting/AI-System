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

/** Lớp tương thích G1 (đọc): giao dịch bị huỷ khi chuyển = `reject` (CR-127); còn lại là "đã ghi sổ" (lưu là có hiệu lực). */
export const legacyStatus = (status: string): "posted" | "cancelled" =>
  status === "reject" ? "cancelled" : "posted";

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

// ── CR-127 X2 · giao dịch gắn HĐ (spec §4.1, §6; business §10.2 BR-48…51) ─────────────────────────────────────────────────────────
// Một giao dịch = MỘT mốc: dòng sản phẩm của giao dịch phải nằm trong HĐ đã chọn, mỗi dòng ánh xạ vào một dòng HĐ (`contract_items`).

export type LinkItemIn = {
  product_id?: string | null | undefined;
  qty?: number | null | undefined;
  unit_price?: number | null | undefined;
};
export type ContractItemRef = { id: string; product_id: string | null };

/**
 * Dòng giao dịch ⇒ SL theo dòng HĐ (`qty_items` của `recordFulfillment`). Dòng có SP không thuộc HĐ (hoặc không gắn SP) ⇒ `mixed`
 * (422 `LINK_MIXED`). Dòng không có SL bị bỏ qua; cùng SP nhiều dòng ⇒ cộng dồn vào dòng HĐ đầu tiên của SP đó.
 */
export function linkQtyItems(
  lines: readonly LinkItemIn[],
  items: readonly ContractItemRef[],
): { mixed: true } | { mixed: false; qty_items: { contract_item_id: string; qty: number }[] } {
  const byProduct = new Map<string, string>();
  for (const it of items)
    if (it.product_id && !byProduct.has(it.product_id)) byProduct.set(it.product_id, it.id);
  const sum = new Map<string, number>();
  for (const l of lines) {
    const item = l.product_id ? byProduct.get(l.product_id) : undefined;
    if (!item) return { mixed: true };
    if (l.qty != null && l.qty > 0) sum.set(item, (sum.get(item) ?? 0) + l.qty);
  }
  return {
    mixed: false,
    qty_items: [...sum].map(([contract_item_id, qty]) => ({ contract_item_id, qty })),
  };
}

/** Giá trị giao dịch: `total_value` người nhập, vắng ⇒ Σ SL × đơn giá các dòng có đủ hai số; không có ⇒ null (mốc tiền: đủ số của mốc). */
export function transactionTotal(
  total: number | null | undefined,
  lines: readonly LinkItemIn[],
): number | null {
  if (total != null) return total;
  let sum = 0;
  let any = false;
  for (const l of lines)
    if (l.qty != null && l.unit_price != null) {
      sum += l.qty * l.unit_price;
      any = true;
    }
  return any ? Math.round(sum) : null;
}

export type LinkVerdict = "ok" | "link_required" | "reason_required";
/** `link` vắng + đối tác còn HĐ mở ⇒ phải chọn; `none` + còn HĐ mở + không lý do ⇒ phải ghi lý do. */
export function linkVerdict(
  link: { none: { reason: string } } | { obligation_id: string } | undefined,
  partnerHasOpen: boolean,
): LinkVerdict {
  if (link === undefined) return partnerHasOpen ? "link_required" : "ok";
  if ("none" in link && partnerHasOpen && link.none.reason.trim() === "") return "reason_required";
  return "ok";
}
