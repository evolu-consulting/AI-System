// V2-D · BA v2 §5.7a (mốc giao mang SL từng dòng; nhiều đợt; trống = giao hết phần còn lại; không giao vượt SL trên HĐ) · §5.7c
// (Mua ⇒ nhập kho / nhập suất gói, hạn gói = ngày kết thúc HĐ; Bán ⇒ xuất; đặt theo khách ⇒ kho không đổi) · §5.7d (thông báo kho
// trước → sau, giá vốn trước → sau) · §5.7f (theo thành phần đã gắn). THUẦN: SL ×10⁴ (bigint), tiền đồng. Không I/O.
import type { ComponentChange, DeliveryMove, StockMode } from "./stock.rules";
import { divRound, fmtQty, parseQty, Q } from "./stock.rules";

export type DeliveryDeal = "buy" | "sell" | "referral" | null;
export type DItem = {
  id: string;
  name: string;
  /** SL trên HĐ (×10⁴); null = dòng không ghi SL. */
  qty: bigint | null;
  unitPrice: number | null;
  productId: string | null;
  componentIds: string[] | null;
  /** Σ đã giao ở các mốc đã xác nhận (×10⁴). */
  delivered: bigint;
};
/** Kế hoạch "Giao lần này" của mốc: dòng → SL (null = phần còn lại). */
export type DPlan = ReadonlyMap<string, bigint | null>;
export type DComp = { id: string; productId: string; name: string; mode: StockMode; ord: number };
export type DCtx = {
  deal: DeliveryDeal;
  contractId: string;
  milestoneId: string;
  /** Ngày kết thúc HĐ (hạn gói suất khi Mua). */
  endDate: string | null;
  supplierKey: string | null;
  /** SL chung cũ của mốc (V2-A `obligations.qty`) — chỉ dùng khi HĐ đúng một dòng có SL và mốc không có bảng SL. */
  milestoneQty: bigint | null;
  /** Đợt giao theo %: phần trăm ×100 (30% = 3000n); null = mốc không ghi %. */
  pct?: bigint | null;
  /** Σ % các đợt giao khác của HĐ đã xác nhận (×100) — đủ 100% ⇒ đợt này lấy phần còn lại. */
  pctBefore?: bigint;
};

export const PCT_FULL = 10_000n;
/** % đầu vào API/DB ("30" | "33.33") ⇒ ×100. */
export const pctOf = (s: string | number | null | undefined): bigint | null =>
  s === null || s === undefined ? null : BigInt(Math.round(Number(s) * 100));

/**
 * Đợt giao theo %: mỗi dòng có SL = làm tròn(% × SL HĐ) (SL nguyên ⇒ làm tròn đơn vị; SL lẻ ⇒ 4 số lẻ), không quá phần còn lại.
 * Đợt cuối (Σ % các đợt đã xác nhận + % này ≥ 100) lấy đúng phần còn lại để tổng khớp 100%. Dòng không ghi SL bỏ qua.
 */
export function splitByPct(
  items: readonly DItem[],
  pct: bigint,
  pctBefore: bigint,
): { itemId: string; qty: bigint }[] {
  const last = pctBefore + pct >= PCT_FULL;
  return items
    .filter((i) => i.qty !== null)
    .map((i) => {
      const rest = maxZero(left(i));
      if (last) return { itemId: i.id, qty: rest };
      const exact = divRound((i.qty ?? 0n) * pct, PCT_FULL);
      const q = (i.qty ?? 0n) % Q === 0n ? divRound(exact, Q) * Q : exact;
      return { itemId: i.id, qty: q > rest ? rest : q };
    });
}
export type DLine = { itemId: string; qty: bigint; planned: bigint | null };

export class DeliveryError extends Error {
  constructor(
    readonly code: "over" | "invalid",
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "DeliveryError";
  }
}

const left = (i: DItem): bigint | null => (i.qty === null ? null : i.qty - i.delivered);

/** Lưu mốc: mỗi dòng của bảng SL thuộc HĐ, không trùng, SL ≤ phần còn lại (null = phần còn lại). Trả lỗi hoặc null. */
export function checkPlan(
  items: readonly DItem[],
  plan: readonly { itemId: string; qty: bigint | null }[],
): DeliveryError | null {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  for (const p of plan) {
    const it = byId.get(p.itemId);
    if (!it || seen.has(p.itemId)) return new DeliveryError("invalid", "dòng không thuộc HĐ");
    seen.add(p.itemId);
    const rest = left(it);
    if (p.qty !== null && p.qty > 0n && (rest === null || p.qty > rest))
      return new DeliveryError(
        "over",
        `${it.name}: giao ${fmtQty(p.qty)}, còn ${fmtQty(rest ?? 0n)}`,
      );
  }
  return null;
}

/** SL giao lần này theo dòng (gồm dòng 0 của bảng SL để giữ "đã giao" khớp). Ném `DeliveryError`. */
export function deliveryLines(items: readonly DItem[], plan: DPlan, ctx: DCtx): DLine[] {
  if (plan.size > 0) {
    const bad = checkPlan(
      items,
      [...plan].map(([itemId, qty]) => ({ itemId, qty })),
    );
    if (bad) throw bad;
    return items
      .filter((i) => plan.has(i.id))
      .map((i) => {
        const planned = plan.get(i.id) ?? null;
        return { itemId: i.id, qty: planned ?? maxZero(left(i)), planned };
      });
  }
  if (ctx.pct !== null && ctx.pct !== undefined)
    return splitByPct(items, ctx.pct, ctx.pctBefore ?? 0n)
      .filter((l) => l.qty > 0n)
      .map((l) => ({ ...l, planned: null }));
  if (ctx.milestoneQty !== null) {
    const withQty = items.filter((i) => i.qty !== null);
    const one = withQty[0];
    if (withQty.length !== 1 || !one)
      throw new DeliveryError(
        "invalid",
        "mốc có một SL chung cho HĐ nhiều dòng: nhập SL từng dòng",
      );
    const rest = maxZero(left(one));
    if (ctx.milestoneQty > rest)
      throw new DeliveryError(
        "over",
        `${one.name}: giao ${fmtQty(ctx.milestoneQty)}, còn ${fmtQty(rest)}`,
      );
    return [{ itemId: one.id, qty: ctx.milestoneQty, planned: ctx.milestoneQty }];
  }
  return items
    .map((i) => ({ itemId: i.id, qty: maxZero(left(i)), planned: null }))
    .filter((l) => l.qty > 0n);
}
const maxZero = (q: bigint | null): bigint => (q === null || q < 0n ? 0n : q);

/** Thành phần một dòng chạm: đã chọn (phải thuộc SP) hoặc mọi thành phần của SP. */
function compsOf(it: DItem, comps: readonly DComp[]): DComp[] {
  const own = comps.filter((x) => x.productId === it.productId).sort((a, b) => a.ord - b.ord);
  if (!it.componentIds?.length) return own;
  const picked = own.filter((x) => it.componentIds?.includes(x.id));
  if (picked.length !== it.componentIds.length)
    throw new DeliveryError("invalid", `${it.name}: thành phần không thuộc SP`);
  return picked;
}

/** Đơn giá dòng chia đều cho k thành phần nhập (đồng lẻ dồn thành phần đầu). */
const share = (price: number, k: number, first: boolean): number =>
  Math.floor(price / k) + (first ? price % k : 0);

/**
 * Dòng nhập/xuất cho `applyDelivery`. Mua: nhập (giá dòng; gói suất hạn = ngày kết thúc HĐ). Bán: xuất theo BQ; thành phần đặt theo
 * khách (`order`) bỏ qua. Giới thiệu / HĐ chưa có loại / dòng không gắn SP: không đụng kho. Ném `DeliveryError`.
 */
export function deliveryMoves(
  lines: readonly DLine[],
  items: readonly DItem[],
  comps: readonly DComp[],
  ctx: DCtx,
): DeliveryMove[] {
  if (ctx.deal !== "buy" && ctx.deal !== "sell") return [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: DeliveryMove[] = [];
  for (const l of lines) {
    const it = byId.get(l.itemId);
    if (!it?.productId || l.qty <= 0n) continue;
    const cs = compsOf(it, comps).filter(
      (x) => x.mode !== "none" && !(ctx.deal === "sell" && x.mode === "order"),
    );
    const base = {
      qty: fmtQty(l.qty),
      contractId: ctx.contractId,
      milestoneId: ctx.milestoneId,
      contractItemId: it.id,
    };
    cs.forEach((x, k) => {
      if (ctx.deal === "sell") {
        out.push({ ...base, componentId: x.id, direction: "out" });
        return;
      }
      if (it.unitPrice === null)
        throw new DeliveryError("invalid", `${it.name}: dòng mua chưa có đơn giá`);
      if (x.mode === "quota" && !ctx.endDate)
        throw new DeliveryError(
          "invalid",
          `${it.name}: HĐ mua dịch vụ có hạn cần ngày kết thúc (hạn gói)`,
        );
      out.push({
        ...base,
        componentId: x.id,
        direction: "in",
        unitPrice: share(it.unitPrice, cs.length, k === 0),
        supplierPartyKey: ctx.supplierKey,
        ...(x.mode === "quota" ? { expiresOn: ctx.endDate } : {}),
      });
    });
  }
  return out;
}

const money = (n: number): string => n.toLocaleString("vi-VN");

/** Cảnh báo giao vượt tồn (cài đặt cho phép): "giao vượt tồn 30: Băng keo (cần 50, còn 20)" — số vượt = cần − còn. */
export function overdrawNotes(
  over: readonly { name: string; need: string; have: string }[],
): string[] {
  return over.map((s) => {
    const neg = s.have.startsWith("-");
    const have = parseQty(neg ? s.have.slice(1) : s.have) ?? 0n;
    const n = (parseQty(s.need) ?? 0n) - (neg ? -have : have);
    return `giao vượt tồn ${fmtQty(n)}: ${s.name} (cần ${s.need}, còn ${s.have})`;
  });
}

/** BA 5.7d: "kho Băng keo 5cm: 320 → 620" (+ "giá vốn …: a → b" khi BQ đổi); gói suất ⇒ "suất …". */
export function stockNotes(changes: readonly (ComponentChange & { name: string })[]): string[] {
  const out: string[] = [];
  for (const x of changes) {
    if (x.mode === "order") {
      out.push(`${x.name}: đặt theo khách, kho không đổi`);
      continue;
    }
    out.push(
      `${x.mode === "quota" ? "suất" : "kho"} ${x.name}: ${x.onHandBefore} → ${x.onHandAfter}`,
    );
    if (x.avgCostBefore !== x.avgCostAfter)
      out.push(`giá vốn ${x.name}: ${money(x.avgCostBefore)} → ${money(x.avgCostAfter)}`);
  }
  return out;
}

/**
 * gap-c #14 · thông báo cho người phụ trách HĐ sau khi xác nhận mốc giao: mỗi thành phần có kho/suất đổi một dòng
 * "kho X: a → b" (+ "giá vốn X: c → d" khi đổi). Thành phần đặt theo khách (kho không đổi) bỏ qua; không còn dòng ⇒ null.
 */
export function deliveryNoticeOf(
  stock: readonly {
    name: string;
    mode: string;
    on_hand_before: string;
    on_hand_after: string;
    avg_cost_before: number;
    avg_cost_after: number;
  }[],
  number: string | null,
): { title: string; body: string } | null {
  const lines: string[] = [];
  for (const x of stock) {
    if (x.mode === "order") continue;
    lines.push(
      `${x.mode === "quota" ? "suất" : "kho"} ${x.name}: ${x.on_hand_before} → ${x.on_hand_after}`,
    );
    if (x.avg_cost_before !== x.avg_cost_after)
      lines.push(`giá vốn ${x.name}: ${money(x.avg_cost_before)} → ${money(x.avg_cost_after)}`);
  }
  if (lines.length === 0) return null;
  const no = (number ?? "").trim().slice(0, 80);
  return {
    title: `Đã xác nhận giao hàng${no ? ` — hợp đồng ${no}` : ""}`.slice(0, 200),
    body: lines.join("\n").slice(0, 2000),
  };
}

/** SL chuỗi từ DB ("12.5000") ⇒ ×10⁴. */
export const qtyOf = (s: string | null): bigint | null => {
  if (s === null) return null;
  const [i = "0", f = ""] = s.split(".");
  return BigInt(i) * Q + BigInt(f.padEnd(4, "0").slice(0, 4));
};
/** SL đầu vào API (number ≤ 4 số lẻ, đã kiểm ở zod) ⇒ ×10⁴; 0 hợp lệ ("không giao đợt này"). */
export const qtyIn = (n: number): bigint => (n === 0 ? 0n : (parseQty(String(n)) ?? 0n));
