// MS-impact · CR-101b (R18, R19, R34; Câu 11): luật THUẦN xem trước tác động khi xác nhận một mốc — dựng đúng phần "sau" mà lệnh
// `settle` sẽ ghi, rồi để engine hiện hành chấm lại (không công thức riêng):
//  · V2-E: mốc xác nhận ⇒ một việc vào nguồn `m:<loại>` (mốc việc của đối tác, loại có tính điểm) hoặc `tx` (còn lại) của ô `rep_cell`,
//    h = bậc thang độ cũ, điểm việc = `milestoneScore` (≡ `rep.sql.ts` ms0: chỉ lỗi ĐỐI TÁC trừ `late_per_day`/ngày).
//  · HD8: dòng sổ `delivered|received|paid` (trễ = `days_late`) ≡ `addGroup` + dòng "Quá hạn" treo của đợt thành "đã trả lời".
//  · Kho: dòng nhập/xuất của mốc giao ⇒ tồn trước → sau theo thành phần. Công nợ: Σ mốc tiền mở cùng chiều trước → sau.
// Lớp 1: không I/O, không đồng hồ.
import { daysLate, roleOf, settledType } from "./ledger.rules";
import { daysBetween } from "./local-time.rules";
import type { CellConfig, RepRole } from "./rep-config.rules";
import { SCORED_MILESTONES } from "./rep-config.rules";
import {
  type CellInput,
  decayAt,
  type Level,
  milestoneScore,
  monthsBefore,
} from "./rep-score.rules";
import { type Agg, addGroup, type Bucket, type Window } from "./scoring-agg.rules";
import type { Role } from "./scoring-config.rules";
import type { DeliveryMove } from "./stock.rules";

export type Fault = "partner" | "ours" | "unknown";

/** Đợt/mốc cần cho xem trước (đọc một câu). `amount` = số tiền đã ghi (null = chưa ghi). */
export type ImpactHead = {
  id: string;
  contract_id: string | null;
  status: string;
  kind: string;
  direction: "pay" | "receive";
  owner: "partner" | "ours" | null;
  due_date: string;
  amount: number | null;
  party: string | null;
  rep_cell: number | null;
  /** Σ số tiền các mốc tiền ĐANG MỞ cùng chiều của HĐ (gồm chính mốc). */
  debt_open: number;
  /** Dòng "Quá hạn" treo (chưa trả lời, chưa huỷ, lỗi đối tác, đúng loại của vai) của chính đợt. */
  overdue: { at: string; due_date: string | null }[];
};

/** Ngày, số ngày trễ, lỗi áp dụng — ≡ `settleOne` (trễ mà không chọn ⇒ `unknown`; đúng hạn ⇒ không có lỗi). */
export function settleFacts(h: Pick<ImpactHead, "due_date">, at: string, fault?: Fault | null) {
  const late = daysLate(at, h.due_date);
  return { late, fault: late > 0 ? (fault ?? "unknown") : null } as const;
}

// ---------- V2-E ----------
export type V2eAdd = { src: string; h: number; hs: number };

/** Phần một mốc góp vào ô (≡ `rep.sql.ts` ms0); ngoài khoảng tính / ngày sau hôm nay ⇒ null (câu chấm không thấy). */
export function v2eContribution(
  o: { owner: string | null; kind: string; due_date: string },
  at: string,
  fault: string | null,
  today: string,
  cell: Pick<CellConfig, "window_months" | "decay" | "late_per_day">,
): V2eAdd | null {
  if (at > today || at <= monthsBefore(today, cell.window_months)) return null;
  const h = decayAt(at, today, cell.decay);
  const scored = o.owner === "partner" && (SCORED_MILESTONES as readonly string[]).includes(o.kind);
  const late = Math.max(0, daysBetween(o.due_date, at));
  return {
    src: scored ? `m:${o.kind}` : "tx",
    h,
    hs: h * milestoneScore(late, fault, cell.late_per_day),
  };
}

/** Đầu vào ô sau khi thêm một việc (bản sao — không đổi `inp`). Ô chưa có ⇒ dựng mới (giá trị 0, chưa sao). */
export function v2eWith(
  inp: CellInput | undefined,
  base: Pick<CellInput, "party" | "role" | "grp">,
  add: V2eAdd,
): CellInput {
  const cur = inp ?? { ...base, sources: {}, value: 0, stars: {} };
  const s = cur.sources[add.src] ?? { n: 0, wh: 0, whs: 0 };
  return {
    ...cur,
    sources: { ...cur.sources, [add.src]: { n: s.n + 1, wh: s.wh + add.h, whs: s.whs + add.hs } },
  };
}

// ---------- HD8 ----------
const cloneBucket = (b: Bucket): Bucket => ({ ...b });
const cloneAgg = (a: Agg): Agg => ({
  ...a,
  set: [cloneBucket(a.set[0]), cloneBucket(a.set[1])],
  pend: [cloneBucket(a.pend[0]), cloneBucket(a.pend[1])],
  rated: { ...a.rated },
  severe: { ...a.severe },
});

/** Dòng sổ mà `settle` sẽ ghi (loại, vai, trễ). */
export function hd8Event(h: Pick<ImpactHead, "kind" | "direction" | "due_date">, at: string) {
  const kind = h.kind === "delivery" ? "delivery" : "payment";
  return {
    type: settledType(kind, h.direction),
    role: roleOf(h.direction),
    late: daysLate(at, h.due_date),
  };
}

/**
 * Gom HD8 sau khi ghi dòng xong đợt: cộng một dòng (≡ `addGroup`) nếu trong khoảng tính, và dòng "Quá hạn" treo của đợt thành đã trả lời
 * (bớt khỏi `pend`, trễ = max(1, hôm nay − hạn) ≡ `pendJson`). Ngoài khoảng ⇒ không đổi.
 */
export function hd8After(
  a: Agg,
  e: { type: string; late: number; at: string },
  role: Role,
  w: Window,
  overdue: readonly { at: string; due_date: string | null }[],
): Agg {
  const out = cloneAgg(a);
  if (e.at < w.start || e.at > w.today) return out;
  addGroup(
    out,
    { type: e.type, nw: e.at >= w.recent, n: 1, on: e.late === 0 ? 1 : 0, late: e.late, delta: 0 },
    role,
  );
  for (const o of overdue) {
    if (o.at < w.start || o.at > w.today) continue;
    const b = out.pend[o.at >= w.recent ? 1 : 0] as Bucket;
    if (b.n <= 0) continue;
    b.n -= 1;
    b.late -= o.due_date ? Math.max(1, daysBetween(o.due_date, w.today)) : 1;
  }
  return out;
}

// ---------- kết quả uy tín ----------
export type RepPointOut = { score: number | null; level: Level };
export type RepImpact = {
  engine: "v2e" | "hd8";
  role: RepRole;
  party: string;
  before: RepPointOut;
  after: RepPointOut;
  counted: boolean;
  pending_fault: boolean;
};
/** HD8 band null ⇒ mức MỚI (≡ `switchDiff`). */
export const hd8Point = (p: { score: number | null; band: string | null } | null): RepPointOut => ({
  score: p?.score ?? null,
  level: (p?.band as Level | null) ?? "new",
});

// ---------- kho + công nợ ----------
const Q = 10_000n;
/** Chuỗi thập phân có dấu ⇒ ×10⁴ (NUMERIC tồn có thể âm khi cho phép giao vượt). */
export function q4(s: string): bigint {
  const neg = s.startsWith("-");
  const [i = "0", f = ""] = (neg ? s.slice(1) : s).split(".");
  const v = BigInt(i || "0") * Q + BigInt(f.padEnd(4, "0").slice(0, 4));
  return neg ? -v : v;
}
export function fmt4(q: bigint): string {
  const neg = q < 0n;
  const a = neg ? -q : q;
  const f = (a % Q).toString().padStart(4, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / Q}${f ? `.${f}` : ""}`;
}

export type StockImpact = { component_id: string; name: string; before: string; after: string };
/** Tồn trước → sau theo thành phần có giữ tồn (`stock`/`quota`); thành phần lạ / không giữ tồn bỏ qua. Thứ tự theo dòng nhập/xuất. */
export function stockAfter(
  moves: readonly Pick<DeliveryMove, "componentId" | "direction" | "qty">[],
  stock: readonly { id: string; name: string; mode: string; on_hand: string }[],
): StockImpact[] {
  const byId = new Map(stock.map((s) => [s.id, s]));
  const acc = new Map<string, { name: string; before: bigint; after: bigint }>();
  for (const m of moves) {
    const s = byId.get(m.componentId);
    if (!s || (s.mode !== "stock" && s.mode !== "quota")) continue;
    const cur = acc.get(m.componentId) ?? {
      name: s.name,
      before: q4(s.on_hand),
      after: q4(s.on_hand),
    };
    cur.after += m.direction === "in" ? q4(m.qty) : -q4(m.qty);
    acc.set(m.componentId, cur);
  }
  return [...acc].map(([id, v]) => ({
    component_id: id,
    name: v.name,
    before: fmt4(v.before),
    after: fmt4(v.after),
  }));
}

const MONEY_KINDS = new Set(["payment", "commission"]);
/** Còn phải thu/trả của HĐ trước → sau (mốc tiền); mốc khác ⇒ null. */
export function debtAfter(
  h: Pick<ImpactHead, "kind" | "direction" | "amount" | "debt_open">,
): { direction: "pay" | "receive"; before: number; after: number } | null {
  if (!MONEY_KINDS.has(h.kind)) return null;
  const before = h.debt_open;
  return { direction: h.direction, before, after: Math.max(0, before - (h.amount ?? 0)) };
}
