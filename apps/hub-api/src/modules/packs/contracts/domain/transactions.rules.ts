// CR-097 G1 · GD-FR-01…05 · intake R9, R10, R27–R32: luật THUẦN của Giao dịch. Trạng thái nháp → đã ghi sổ → (đã huỷ); dòng hàng
// (SL ×10⁴, tiền đồng chưa VAT); dòng kho sinh bằng CHÍNH `deliveryMoves` của giao hàng HĐ (V2-D: mua ⇒ nhập giá chia đều thành
// phần, gói suất có hạn; bán ⇒ xuất theo BQ, bỏ thành phần đặt theo khách) nhưng không ref HĐ/mốc; nghĩa vụ thanh toán một đợt.
// Đồng bộ lưới an toàn `contracts.g1_transactions_guard` (0051). Không I/O.
import { type DComp, DeliveryError, deliveryMoves } from "./delivery.rules";
import { amountOf, type DeliveryMove, fmtQty, MONEY_MAX, parseQty } from "./stock.rules";

export type TxDeal = "buy" | "sell";
export type TxStatus = "draft" | "posted" | "cancelled";
export type TxAction = "edit" | "delete" | "post" | "describe" | "adjust" | "cancel";

export class TxRuleError extends Error {
  constructor(
    readonly kind: "state" | "invalid" | "stock" | "not_found",
    readonly detail: string = kind,
  ) {
    super(detail);
    this.name = "TxRuleError";
  }
}

const ALLOWED: Record<TxStatus, readonly TxAction[]> = {
  draft: ["edit", "delete", "post"],
  posted: ["describe", "adjust", "cancel"],
  cancelled: [],
};

/** GD-FR-01 nháp sửa/xoá tự do · GD-FR-02 ghi sổ · GD-FR-03/04/05 sau ghi sổ: mô tả, điều chỉnh, huỷ · đã huỷ chỉ đọc. */
export const canDo = (status: TxStatus, action: TxAction): boolean =>
  ALLOWED[status].includes(action);

export function assertCan(status: TxStatus, action: TxAction): void {
  if (!canDo(status, action))
    throw new TxRuleError("state", `giao dịch ${status}: không ${action} được`);
}

export type TxLineIn = {
  name: string;
  product_id?: string | null | undefined;
  component_ids?: string[] | null | undefined;
  unit?: string | null | undefined;
  qty: string;
  unit_price: number;
};
export type TxLinePlanned = {
  ord: number;
  name: string;
  productId: string | null;
  componentIds: string[] | null;
  unit: string | null;
  qty: string;
  unitPrice: number;
  amount: number;
};

function checkProduct(l: TxLineIn, i: number, comps: readonly DComp[]): void {
  if (!l.product_id) {
    if (l.component_ids?.length)
      throw new TxRuleError("invalid", `dòng ${i + 1}: thành phần cần SP`);
    return;
  }
  const own = comps.filter((c) => c.productId === l.product_id);
  if (own.length === 0) throw new TxRuleError("invalid", `dòng ${i + 1}: SP không có`);
  if (l.component_ids?.some((id) => !own.some((c) => c.id === id)))
    throw new TxRuleError("invalid", `dòng ${i + 1}: thành phần không thuộc SP`);
}

/** Dòng hàng ⇒ thành tiền (SL × đơn giá, làm tròn đồng) + tổng ≤ 10¹⁵. `comps` = thành phần của các SP được gắn. */
export function planLines(
  lines: readonly TxLineIn[],
  comps: readonly DComp[],
): { lines: TxLinePlanned[]; total: number } {
  let total = 0n;
  const out = lines.map((l, i) => {
    const q = parseQty(l.qty);
    if (q === null || q <= 0n) throw new TxRuleError("invalid", `dòng ${i + 1}: SL sai`);
    if (!Number.isSafeInteger(l.unit_price) || l.unit_price < 0)
      throw new TxRuleError("invalid", `dòng ${i + 1}: đơn giá sai`);
    checkProduct(l, i, comps);
    const amount = amountOf(q, BigInt(l.unit_price));
    total += amount;
    if (amount > MONEY_MAX || total > MONEY_MAX)
      throw new TxRuleError("invalid", "tổng giao dịch vượt giới hạn");
    return {
      ord: i,
      name: l.name,
      productId: l.product_id ?? null,
      componentIds: l.component_ids?.length ? [...l.component_ids] : null,
      unit: l.unit ?? null,
      qty: fmtQty(q),
      unitPrice: l.unit_price,
      amount: Number(amount),
    };
  });
  return { lines: out, total: Number(total) };
}

/**
 * Dòng nhập/xuất cho `applyDelivery` (GD-FR-02/04): tái dùng `deliveryMoves` của V2-D trên các dòng gắn SP; bỏ mọi ref HĐ/mốc/dòng
 * HĐ (dòng sổ kho của giao dịch mang `transaction_id`, gắn ở adapter). Mua gói suất cần `validUntil` (hạn gói). Ném `TxRuleError`.
 */
export function stockMovesOf(
  t: { deal: TxDeal; partyKey: string | null; validUntil: string | null },
  lines: readonly (TxLinePlanned & { id: string })[],
  comps: readonly DComp[],
): DeliveryMove[] {
  const items = lines
    .filter((l) => l.productId !== null)
    .map((l) => ({
      id: l.id,
      name: l.name,
      qty: parseQty(l.qty),
      unitPrice: l.unitPrice,
      productId: l.productId,
      componentIds: l.componentIds,
      delivered: 0n,
    }));
  const dl = items.map((i) => ({ itemId: i.id, qty: i.qty ?? 0n, planned: i.qty }));
  try {
    return deliveryMoves(dl, items, comps, {
      deal: t.deal,
      contractId: "",
      milestoneId: "",
      endDate: t.validUntil,
      supplierKey: t.partyKey,
      milestoneQty: null,
    }).map((m) => ({ ...m, contractId: null, milestoneId: null, contractItemId: null }));
  } catch (e) {
    if (e instanceof DeliveryError)
      throw new TxRuleError(
        "invalid",
        e.detail.replace("HĐ mua dịch vụ có hạn cần ngày kết thúc", "mua gói có hạn cần hạn gói"),
      );
    throw e;
  }
}

/** Nghĩa vụ thanh toán còn phải sinh: tổng − phần đã xong; ≤ 0 ⇒ null. Bán ⇒ thu, mua ⇒ trả; seq = rev + 1. */
export function obligationOf(t: {
  deal: TxDeal;
  total: number;
  done: number;
  dueOn: string | null;
  occurredOn: string;
  rev: number;
}): { direction: "receive" | "pay"; amount: number; dueDate: string; seq: number } | null {
  const amount = t.total - t.done;
  if (amount <= 0) return null;
  return {
    direction: t.deal === "sell" ? "receive" : "pay",
    amount,
    dueDate: t.dueOn ?? t.occurredOn,
    seq: t.rev + 1,
  };
}

export type TxDescribe = { note: string | null; holder: string | null; lot_label: string | null };

/** GD-FR-03: trường mô tả đổi thật (trước → sau); không đổi gì ⇒ invalid. */
export function describeChanges(
  before: TxDescribe,
  patch: Partial<TxDescribe>,
): Partial<Record<keyof TxDescribe, { from: string | null; to: string | null }>> {
  const out: Partial<Record<keyof TxDescribe, { from: string | null; to: string | null }>> = {};
  for (const k of ["note", "holder", "lot_label"] as const) {
    const v = patch[k];
    if (v === undefined || v === before[k]) continue;
    out[k] = { from: before[k], to: v };
  }
  if (Object.keys(out).length === 0) throw new TxRuleError("invalid", "không có gì thay đổi");
  return out;
}
