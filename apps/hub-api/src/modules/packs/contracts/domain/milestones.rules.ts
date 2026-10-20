// V2-A · BA v2 §2 (Loại HĐ, Mốc HĐ, giai đoạn) · §3.1 HD-01/HD-09/HD-11 · §5.4 (5.4a/5.4c) · intake C2: luật thuần của mốc HĐ.
// Mốc = hàng `contracts.obligations` (C2: mở rộng, không bảng mới). 7 loại BA ↔ cột DB: Thu tiền/Thanh toán = `payment` với
// hướng tiền (`receive`/`pay`); loại khác giữ hướng theo HĐ (bán/giới thiệu ⇒ receive, mua ⇒ pay) như đợt HD7. Tiền = số nguyên đồng
// ≤ 10¹⁵; phép chia/nhân qua BigInt (không số thực). Ngày = `YYYY-MM-DD` (so sánh chuỗi = so sánh lịch). Lớp 1: không I/O.

export const DEALS = ["buy", "sell", "referral"] as const;
export type Deal = (typeof DEALS)[number];
export const MILESTONE_KINDS = [
  "delivery",
  "collect",
  "pay",
  "commission",
  "serial",
  "renewal",
  "other",
] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];
export type DbKind = "payment" | "delivery" | "commission" | "serial" | "renewal" | "other";
export type Owner = "ours" | "partner";
export type Fault = "partner" | "ours" | "unknown";
export type Stage = "not_started" | "in_progress" | "done";
type Flow = "pay" | "receive";

export const MILESTONE_TITLES: Record<MilestoneKind, string> = {
  delivery: "Giao hàng",
  collect: "Thu tiền",
  pay: "Thanh toán",
  commission: "Nhận hoa hồng",
  serial: "Cấp serial / kích hoạt",
  renewal: "Nhắc gia hạn",
  other: "Khác",
};
const MONEY_KINDS: ReadonlySet<MilestoneKind> = new Set(["collect", "pay", "commission"]);

/** Backfill / HĐ cũ: `direction` ⇒ loại HĐ. */
export const dealOfDirection = (d: string | null | undefined): Deal | null =>
  d === "sale" ? "sell" : d === "purchase" ? "buy" : null;
/** Giới thiệu = tiền vào (đối tác là bên trả hoa hồng, nằm ở phía bên mua như HĐ bán). */
export const directionOfDeal = (deal: Deal): "purchase" | "sale" =>
  deal === "buy" ? "purchase" : "sale";

/** Loại BA ⇒ (kind, direction) của hàng đợt. */
export function toDb(kind: MilestoneKind, deal: Deal): { kind: DbKind; direction: Flow } {
  if (kind === "collect") return { kind: "payment", direction: "receive" };
  if (kind === "pay") return { kind: "payment", direction: "pay" };
  return { kind, direction: deal === "buy" ? "pay" : "receive" };
}
/** Hàng đợt ⇒ loại BA. */
export function fromDb(kind: string, direction: string): MilestoneKind {
  if (kind === "payment") return direction === "receive" ? "collect" : "pay";
  return kind as MilestoneKind;
}

/** "Việc của ai" mặc định (BA §2: việc của mình không tính điểm đối tác). */
export function defaultOwner(kind: MilestoneKind, deal: Deal): Owner {
  if (kind === "collect" || kind === "commission") return "partner";
  if (kind === "delivery" || kind === "serial") return deal === "buy" ? "partner" : "ours";
  return "ours";
}

/** HD-11: SL chỉ cho Giao hàng; số tiền chỉ cho Thu tiền / Thanh toán / Nhận hoa hồng. */
export function checkMilestone(m: {
  kind: MilestoneKind;
  qty: number | null;
  amount: number | null;
}): "ok" | "qty_kind" | "amount_kind" {
  if (m.qty !== null && m.kind !== "delivery") return "qty_kind";
  if (m.amount !== null && !MONEY_KINDS.has(m.kind)) return "amount_kind";
  return "ok";
}

/** Mốc tiền chính của loại HĐ (5.4a chia giá trị cho loại này). */
export const primaryMoneyKind = (deal: Deal): MilestoneKind =>
  deal === "buy" ? "pay" : deal === "sell" ? "collect" : "commission";

/** % (≤ 2 chữ số thập phân, số hoặc chuỗi NUMERIC) ⇒ phần vạn nguyên. */
const hundredths = (pct: number | string): bigint => BigInt(Math.round(Number(pct) * 100));

/** 5.4c: hoa hồng dự kiến = cố định, hoặc phí gốc × % làm tròn nửa lên tới đồng; thiếu dữ liệu ⇒ null. */
export function commissionTotal(c: {
  value: number | null;
  pct: number | string | null;
  fixed: number | null;
}): number | null {
  if (c.fixed !== null) return c.fixed;
  if (c.value === null || c.pct === null) return null;
  return Number((BigInt(c.value) * hundredths(c.pct) + 5_000n) / 10_000n);
}

/** Cơ sở chia của 5.4a theo loại HĐ: giá trị HĐ (mua/bán) hoặc hoa hồng dự kiến (giới thiệu). */
export function moneyBase(c: {
  deal: Deal;
  value: number | null;
  pct: number | string | null;
  fixed: number | null;
}): number | null {
  return c.deal === "referral" ? commissionTotal(c) : c.value;
}

type Priced = { id: string; kind: MilestoneKind; amount: number | null; status: string };

/**
 * 5.4a: số tiền mốc = trường Số tiền; mốc tiền chính để trống chia đều PHẦN CÒN LẠI của cơ sở (cơ sở − Σ số tiền đã ghi của mốc
 * tiền chính, âm ⇒ 0); đồng lẻ dồn lần lượt vào các mốc trống đầu (tổng đúng từng đồng). Mốc huỷ không tính. Mốc trống loại khác ⇒ null.
 */
export function effectiveAmounts(
  ms: readonly Priced[],
  base: number | null,
  primary: MilestoneKind,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const live = ms.filter((m) => m.kind === primary && m.status !== "cancelled");
  const blanks = live.filter((m) => m.amount === null);
  const fixed = live.reduce((s, m) => s + BigInt(m.amount ?? 0), 0n);
  const rest = base === null ? null : BigInt(base) > fixed ? BigInt(base) - fixed : 0n;
  const n = BigInt(blanks.length);
  blanks.forEach((m, i) => {
    out.set(m.id, rest === null ? null : Number(rest / n + (BigInt(i) < rest % n ? 1n : 0n)));
  });
  for (const m of ms) if (!out.has(m.id)) out.set(m.id, m.amount);
  return out;
}

export type NewMilestone = { kind: MilestoneKind; title: string; due_date: string; owner: Owner };

/** HD-01: mốc mặc định khi LƯU theo loại. Giao = bắt đầu ?? ký ?? hôm nay; tiền = kết thúc ?? bắt đầu ?? ký ?? hôm nay. */
export function defaultMilestones(c: {
  deal: Deal;
  start: string | null;
  end: string | null;
  signed: string | null;
  today: string;
}): NewMilestone[] {
  const give = c.start ?? c.signed ?? c.today;
  const money = c.end ?? c.start ?? c.signed ?? c.today;
  const one = (kind: MilestoneKind, due: string): NewMilestone => ({
    kind,
    title: MILESTONE_TITLES[kind],
    due_date: due,
    owner: defaultOwner(kind, c.deal),
  });
  if (c.deal === "referral") return [one("commission", money)];
  return [one("delivery", give), one(primaryMoneyKind(c.deal), money)];
}

type Staged = { id: string; kind: MilestoneKind; status: string; due_date: string; seq: number };
/** Nhắc gia hạn là lời nhắc, không phải việc phải xong để HĐ xong. */
const required = (m: Staged) => m.kind !== "renewal" && m.status !== "cancelled";

/** KN-04: Đã xong (mọi mốc bắt buộc xong) · Chưa bắt đầu (chưa mốc nào xong, chưa tới ngày bắt đầu) · còn lại Đang thực hiện. */
export function stageOf(c: {
  today: string;
  start: string | null;
  milestones: readonly Staged[];
}): Stage {
  const req = c.milestones.filter(required);
  if (req.length > 0 && req.every((m) => m.status === "done")) return "done";
  const anyDone = c.milestones.some((m) => m.status === "done");
  if (!anyDone && (c.start === null || c.today < c.start)) return "not_started";
  return "in_progress";
}

/** Bước hiện tại = mốc mở có hạn sớm nhất (hạn, seq); quá hạn khi hạn < hôm nay. */
export function nextStep(
  ms: readonly Staged[],
  today: string,
): { id: string; overdue: boolean } | null {
  let best: Staged | null = null;
  for (const m of ms) {
    if (m.status !== "open") continue;
    if (!best || m.due_date < best.due_date || (m.due_date === best.due_date && m.seq < best.seq))
      best = m;
  }
  return best ? { id: best.id, overdue: best.due_date < today } : null;
}
