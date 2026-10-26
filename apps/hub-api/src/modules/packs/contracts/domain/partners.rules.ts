// HD8-FR-01 · HD8-FR-02 · HD8-FR-04 · port NGUYÊN `mgmt-app/api/app/scoring/service.py` (`_facts`, `partners`, `preview`,
// `ratings`) + `routes/scoring.py::partners` (role=all: mỗi đối tác một dòng, vai giao dịch nhiều nhất). Thuần: dữ liệu cả tenant
// (điểm tính trên CẢ sổ như mgmt, đã gom theo (đối tác, vai)) + tập đối tác người dùng thấy (M1: `view.company`).

import type { PricedContract } from "./goods-prices.rules";
import {
  type Agg,
  cmp,
  type Ev,
  type Facts,
  type ScoreOut,
  scoreAgg,
  windowStart,
} from "./scoring.rules";
import { emptyAgg, SEVERE_TYPES, type SevereType } from "./scoring-agg.rules";
import type { Criterion, Role, Rules } from "./scoring-config.rules";

export type Cfg = { criteria: readonly Criterion[]; rules: Rules };
/** Sự kiện sổ kèm khoá đối tác + vai + id (đọc thẳng `partner_events`, `voided` suy từ bảng huỷ). */
export type PartyEv = Ev & { id: string; party: string; role: Role; note?: string | null };
export type FactContract = PricedContract & { start: string | null };
/**
 * Sự thật HĐ đã gom ở SQL theo (vai, tên, MST) của bên đối tác (Luật 4c: một dòng mỗi nhóm thay vì mỗi HĐ), xếp theo HĐ tạo sớm
 * nhất của nhóm. Nhiều nhóm có thể cùng một khoá đối tác (cùng MST, tên viết khác) ⇒ gộp ở `factsOf`.
 */
export type FactRow = {
  role: Role;
  name: string | null;
  tax: string | null;
  party: string | null;
  n: number;
  first_start: string | null;
};
type F = Required<Pick<Facts, "contracts">> & {
  first_start: string | null;
  name: string | null;
  price_gap_pct?: number;
};
export type PartnerOut = {
  party: string;
  name: string;
  role: Role;
  roles: Role[];
  score: number | null;
  band: ScoreOut["band"];
  reason: string;
  event_count: number;
  breakdown: ScoreOut["breakdown"];
  adjust: number;
  contracts: number;
  /** U2 · R36: "MỚI · tạm tính" — `score` null nhưng có điểm tạm. */
  provisional: boolean;
  provisional_score: number | null;
  /** U2 · R39: cờ đỏ của ĐỐI TÁC (mọi vai đã đọc): còn dòng nghiêm trọng chưa huỷ trong khoảng tính; tách khỏi điểm. */
  red_flag: boolean;
  red_flags: { type: SevereType; n: number }[];
};

/** Cờ đỏ của một đối tác: cộng dòng nghiêm trọng của các vai (khách + NCC) có trong `aggs`. */
export function redFlagsOf(
  aggs: ReadonlyMap<string, Agg>,
  party: string,
): { type: SevereType; n: number }[] {
  const out: { type: SevereType; n: number }[] = [];
  for (const type of SEVERE_TYPES) {
    const n = (["customer", "supplier"] as const).reduce(
      (s, r) => s + (aggs.get(k(party, r))?.severe[type] ?? 0),
      0,
    );
    if (n > 0) out.push({ type, n });
  }
  return out;
}

/** Khoá nhóm (đối tác, vai). */
export const aggKey = (party: string, role: Role) => `${role}|${party}`;
const k = aggKey;

/** Thêm vào mảng của khoá (không chép lại mảng ⇒ O(n)). */
function pushTo<K, V>(m: Map<K, V[]>, key: K, v: V): void {
  const a = m.get(key);
  if (a) a.push(v);
  else m.set(key, [v]);
}

function flagsOf(aggs: ReadonlyMap<string, Agg>, party: string) {
  const red_flags = redFlagsOf(aggs, party);
  return { red_flag: red_flags.length > 0, red_flags };
}

/** `_facts`: (đối tác, vai) → số HĐ, ngày bắt đầu sớm nhất, tên (HĐ đầu), % chênh giá (NCC). Chỉ HĐ loại `contract`. */
export function factsOf(
  rows: readonly FactRow[],
  gaps: ReadonlyMap<string, number>,
): Map<string, F & { party: string; role: Role }> {
  const out = new Map<string, F & { party: string; role: Role }>();
  for (const r of rows) {
    if (!r.party) continue;
    const key = k(r.party, r.role);
    const f = out.get(key) ?? {
      party: r.party,
      role: r.role,
      contracts: 0,
      first_start: null,
      name: null,
    };
    f.contracts += r.n;
    if (r.first_start && (!f.first_start || r.first_start < f.first_start))
      f.first_start = r.first_start;
    f.name = f.name || r.name;
    const gap = gaps.get(r.party);
    if (r.role === "supplier" && gap !== undefined) f.price_gap_pct = gap;
    out.set(key, f);
  }
  return out;
}

export function groupEvents(events: readonly PartyEv[]): Map<string, PartyEv[]> {
  const by = new Map<string, PartyEv[]>();
  for (const e of events) {
    const key = k(e.party, e.role);
    pushTo(by, key, e);
  }
  return by;
}

/** `service.partners`: mỗi (đối tác, vai) người dùng thấy, chấm từ sổ; xếp điểm giảm dần, chưa có điểm cuối, rồi tên. */
export function partnersOf(i: {
  facts: ReadonlyMap<string, F & { party: string; role: Role }>;
  /** Đầu vào đã gom theo (đối tác, vai) — khoá `vai|đối tác` (`aggKey`); thiếu ⇒ chưa có dòng sổ nào trong khoảng tính. */
  aggs: ReadonlyMap<string, Agg>;
  /** Danh bạ: tên ngắn ?? tên của đối tác (mgmt `short_name or name or tên trên HĐ`). */
  names?: ReadonlyMap<string, string>;
  cfgs: Readonly<Record<Role, Cfg>>;
  today: string;
  role: Role | null;
  visible: (party: string) => boolean;
}): PartnerOut[] {
  const facts = [...i.facts.values()].filter((f) => i.visible(f.party));
  const rolesOf = new Map<string, Role[]>();
  for (const f of facts) pushTo(rolesOf, f.party, f.role);
  const rows: PartnerOut[] = [];
  for (const f of facts) {
    if (i.role && f.role !== i.role) continue;
    const s = scoreAgg(i.aggs.get(k(f.party, f.role)) ?? emptyAgg(), i.cfgs[f.role], {
      today: i.today,
      role: f.role,
      facts: f,
    });
    rows.push({
      party: f.party,
      name: i.names?.get(f.party) || f.name || "",
      role: f.role,
      roles: [...(rolesOf.get(f.party) ?? [])].sort(),
      score: s.score,
      band: s.band,
      reason: s.reason,
      event_count: s.event_count,
      breakdown: s.breakdown,
      adjust: s.adjust,
      contracts: f.contracts,
      provisional: s.provisional,
      provisional_score: s.provisional_score,
      ...flagsOf(i.aggs, f.party),
    });
  }
  return rows.sort(
    (a, b) =>
      Number(a.score === null) - Number(b.score === null) ||
      -(a.score ?? 0) + (b.score ?? 0) ||
      cmp(a.name, b.name),
  );
}

/** `routes/scoring.partners` role=all: đối tác vừa là khách vừa là NCC chỉ một dòng — vai có (event_count, contracts) lớn hơn. */
export function onePerParty(rows: readonly PartnerOut[]): PartnerOut[] {
  const best = new Map<string, PartnerOut>();
  for (const p of rows) {
    const o = best.get(p.party);
    if (
      !o ||
      p.event_count > o.event_count ||
      (p.event_count === o.event_count && p.contracts > o.contracts)
    )
      best.set(p.party, p);
  }
  return rows.filter((p) => best.get(p.party) === p);
}

/** `service.preview`: điểm hiện tại và theo bản nháp; không ghi gì. */
export function previewOf(old: readonly PartnerOut[], next: readonly PartnerOut[]) {
  const was = new Map(old.map((p) => [p.party, p]));
  const changes = next
    .filter((p) => p.score !== was.get(p.party)?.score)
    .map((p) => ({
      party: p.party,
      name: p.name,
      old: was.get(p.party)?.score ?? null,
      new: p.score,
      band_old: was.get(p.party)?.band ?? null,
      band_new: p.band,
    }));
  changes.sort(
    (a, b) => Math.abs((b.new ?? 0) - (b.old ?? 0)) - Math.abs((a.new ?? 0) - (a.old ?? 0)),
  );
  return {
    changes,
    changed_band: changes.filter((c) => c.band_old !== c.band_new).length,
    total: next.length,
  };
}

/** `service.ratings`: tiêu chí tự chấm của vai + lần chấm mới nhất của đối tác (`counts` = còn trong khoảng tính), và mọi lần chấm. */
export function ratingsOf(cfg: Cfg, events: readonly PartyEv[], today: string) {
  const rows = events
    .filter((e) => e.type === "rating" && !e.voided)
    .sort((a, b) => cmp(b.at, a.at) || cmp(b.rated_at ?? "", a.rated_at ?? ""));
  const names = new Map(cfg.criteria.map((c) => [c.key, c.label]));
  const start = windowStart(cfg.rules, today);
  const one = (e: PartyEv) => ({
    id: e.id,
    value: e.value as number,
    note: e.note ?? null,
    by: e.by ?? null,
    at: e.at,
    rated_at: e.rated_at ?? null,
  });
  return {
    criteria: cfg.criteria
      .filter((c) => c.kind === "manual")
      .map((c) => {
        const last = rows.find((e) => e.criterion === c.key);
        return {
          key: c.key,
          label: c.label,
          weight: c.weight,
          enabled: c.enabled,
          current: last ? { ...one(last), counts: last.at >= start } : null,
        };
      }),
    history: rows.map((e) => ({
      ...one(e),
      criterion: e.criterion as string,
      label: names.get(e.criterion as string) ?? "Tiêu chí đã xoá",
    })),
  };
}
