// REP-v3 · CR-101b (BA v2.0 §5.1, Câu 2; R23, R61, R63, R71): engine điểm HIỆN HÀNH theo cờ `REPUTATION_ENGINE` (`v2e` | `hd8`,
// mặc định `hd8` = TẮT), so mức HD8 hiện hành với V2-E để xem trước "N đối tác đổi mức nếu bật", cờ đỏ U2 gắn vào bảng V2-E (tách
// khỏi điểm), TQ-04 "đối tác cần xem lại" (CHÚ Ý, cờ đỏ, hoặc giảm ≥ 3 điểm so với kỳ chốt 3 tháng trước). Thuần.
import type { RepRole } from "./rep-config.rules";
import type { Level } from "./rep-score.rules";

export type RepEngine = "v2e" | "hd8";
/** Giá trị cờ ⇒ engine; lạ / vắng ⇒ `hd8` (fail-closed: không đổi điểm khách khi cấu hình sai). */
export const repEngineOf = (v: string | undefined | null): RepEngine =>
  v?.trim().toLowerCase() === "v2e" ? "v2e" : "hd8";

export type SevereFlag = { type: "no_delivery" | "fraud"; n: number };
/** Cờ đỏ theo đối tác (cộng mọi vai), hàng thô `[party, type, n]`. */
export function flagsByParty(rows: readonly [string, string, number][]): Map<string, SevereFlag[]> {
  const out = new Map<string, SevereFlag[]>();
  for (const [party, type, n] of rows) {
    if ((type !== "no_delivery" && type !== "fraud") || !(n > 0)) continue;
    const a = out.get(party) ?? [];
    a.push({ type, n });
    out.set(party, a);
  }
  for (const a of out.values()) a.sort((x, y) => (x.type < y.type ? -1 : 1));
  return out;
}

type Scored = { party: string; role: RepRole; score: number | null; level: Level };
/** Gắn cờ đỏ (U2, tách khỏi điểm: không đổi `score`/`level`). `red_flags` chỉ có khi có cờ (Luật 4c: bảng 3.000 dòng gọn hơn). */
export function withFlags<R extends { party: string }>(
  rows: readonly R[],
  flags: ReadonlyMap<string, SevereFlag[]>,
): (R & { red_flag: boolean; red_flags?: SevereFlag[] })[] {
  return rows.map((r) => {
    const f = flags.get(r.party);
    return f?.length ? { ...r, red_flag: true, red_flags: f } : { ...r, red_flag: false };
  });
}

/** TQ-04 (R71): giảm từ `DROP` điểm so với kỳ chốt `months` tháng trước. */
export const ATTENTION_DROP = 3;
export const ATTENTION_MONTHS = 3;

export type AttentionReason = "red_flag" | "watch" | "drop";
export type AttentionRow<R> = R & {
  reasons: AttentionReason[];
  before: number | null;
  drop: number | null;
};
/** Đối tác × vai cần xem lại: cờ đỏ, mức CHÚ Ý, hoặc giảm ≥ 3 điểm so với kỳ chốt cũ. Cờ đỏ lên đầu, rồi giảm nhiều trước. */
export function attentionOf<R extends Scored & { red_flag: boolean }>(
  rows: readonly R[],
  before: ReadonlyMap<string, number>,
): AttentionRow<R>[] {
  const out: AttentionRow<R>[] = [];
  for (const r of rows) {
    const b = before.get(`${r.party}\u0001${r.role}`) ?? null;
    const drop = b !== null && r.score !== null ? b - r.score : null;
    const reasons: AttentionReason[] = [];
    if (r.red_flag) reasons.push("red_flag");
    if (r.level === "watch") reasons.push("watch");
    if (drop !== null && drop >= ATTENTION_DROP) reasons.push("drop");
    if (reasons.length) out.push({ ...r, reasons, before: b, drop });
  }
  const rank = (x: AttentionRow<R>) => (x.red_flag ? 0 : 1);
  return out.sort((x, y) => rank(x) - rank(y) || (y.drop ?? -1e9) - (x.drop ?? -1e9));
}

/** Kỳ chốt (YYYY-MM-01) `months` tháng trước tháng của `today`. */
export function periodBefore(today: string, months: number): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 - months, 1)).toISOString().slice(0, 10);
}

type Hd8Row = {
  party: string;
  name: string;
  score: number | null;
  band: "good" | "fair" | "watch" | null;
};
type V2eRow = { party: string; name: string; role: RepRole; score: number | null; level: Level };
export type SwitchItem = {
  party: string;
  name: string;
  role: RepRole;
  hd8: { score: number | null; level: Level };
  v2e: { score: number | null; level: Level };
};
export type SwitchPreview = {
  /** Số đối tác × vai được so. */
  total: number;
  /** Số đối tác × vai đổi mức nếu bật V2-E. */
  changed: number;
  /** Số đối tác (khác nhau) có ít nhất một vai đổi mức. */
  partners: number;
  moves: { from: Level; to: Level; n: number }[];
  items: SwitchItem[];
};

/**
 * Xem trước bật V2-E: mức HD8 hiện hành (band; chưa đủ việc ⇒ `new`) vs mức V2-E, theo (đối tác, vai). Vai bên trả hoa hồng của
 * V2-E so với điểm Khách hàng HD8 (U1 Q3: HD8 tính bên trả HH như Khách). Thiếu một phía ⇒ phía đó `new`. Chỉ đọc.
 */
export function switchDiff(
  hd8: { customer: readonly Hd8Row[]; supplier: readonly Hd8Row[] },
  v2e: readonly V2eRow[],
): SwitchPreview {
  const hd = new Map<string, Hd8Row>();
  for (const role of ["customer", "supplier"] as const)
    for (const r of hd8[role]) hd.set(`${r.party}\u0001${role}`, r);
  const items: SwitchItem[] = [];
  const seen = new Set<string>();
  const push = (party: string, name: string, role: RepRole, h?: Hd8Row, v?: V2eRow) =>
    items.push({
      party,
      name,
      role,
      hd8: { score: h?.score ?? null, level: h?.band ?? "new" },
      v2e: { score: v?.score ?? null, level: v?.level ?? "new" },
    });
  for (const v of v2e) {
    const hdRole = v.role === "commission_payer" ? "customer" : v.role;
    const k = `${v.party}\u0001${hdRole}`;
    if (v.role !== "commission_payer") seen.add(k);
    push(v.party, v.name, v.role, hd.get(k), v);
  }
  for (const [k, h] of hd) {
    if (seen.has(k)) continue;
    push(h.party, h.name, k.split("\u0001")[1] as RepRole, h);
  }
  const changedItems = items.filter((i) => i.hd8.level !== i.v2e.level);
  const moves = new Map<string, { from: Level; to: Level; n: number }>();
  for (const i of changedItems) {
    const key = `${i.hd8.level}>${i.v2e.level}`;
    const m = moves.get(key) ?? { from: i.hd8.level, to: i.v2e.level, n: 0 };
    m.n++;
    moves.set(key, m);
  }
  return {
    total: items.length,
    changed: changedItems.length,
    partners: new Set(changedItems.map((i) => i.party)).size,
    moves: [...moves.values()].sort((a, b) => b.n - a.n),
    items: changedItems.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : a.role < b.role ? -1 : 1,
    ),
  };
}
