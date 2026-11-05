// U3 · CR-097a (R33–R46) · luật thuần của điểm đối tác theo engine HD8 (`/partners`): mức, "MỚI · tạm tính", cờ đỏ (tách khỏi điểm),
// gộp hai vai thành một dòng mỗi đối tác, khối "đối tác cần xem lại" của Tổng quan, top theo số việc.
import type {
  PartnerRole,
  PartnerRow,
  RepAttentionRow,
  RepPartnerRow,
  RepRole,
  ScoreBand,
} from "@ai/contracts";
import { REP_ROLE_ORDER, ROLES } from "./partner-v2";

/** Dòng điểm đối tác × vai của MỌI engine: HD8 (`PartnerRow`) hoặc V2-E (`RepPartnerRow` đã quy đổi, thêm vai bên trả hoa hồng). */
export type ScoreRow = Omit<PartnerRow, "role" | "roles"> & {
  role: RepRole;
  roles?: PartnerRole[];
};

/** `none` = chưa có việc nào ("– · Chưa đủ dữ liệu"); `new` = có điểm tạm (MỚI · tạm tính). */
export type Level = ScoreBand | "new" | "none";
type Scored = Pick<PartnerRow, "score" | "band" | "provisional" | "provisional_score">;

export type Badge = {
  level: Level;
  /** Số hiện trên huy hiệu: điểm thật, hoặc điểm tạm khi MỚI; null ⇒ "–". */
  shown: number | null;
  provisional: boolean;
};

export function badgeOf(r: Scored): Badge {
  if (r.score !== null && r.band) return { level: r.band, shown: r.score, provisional: false };
  if (r.provisional) return { level: "new", shown: r.provisional_score ?? null, provisional: true };
  return { level: "none", shown: null, provisional: false };
}

const RANK: Record<Level, number> = { watch: 0, fair: 1, good: 2, new: 3, none: 4 };
export const worstOf = (rows: readonly Scored[]): Level =>
  rows.reduce<Level>((w, r) => {
    const l = badgeOf(r).level;
    return RANK[l] < RANK[w] ? l : w;
  }, "none");

export type FlagType = NonNullable<PartnerRow["red_flags"]>[number]["type"];
export type Flag = { type: FlagType; n: number };

/** Cờ đỏ gộp mọi vai (cùng loại cộng số lần). */
export function flagsOf(rows: readonly Pick<PartnerRow, "red_flags">[]): Flag[] {
  const by = new Map<FlagType, number>();
  for (const r of rows)
    for (const f of r.red_flags ?? []) by.set(f.type, (by.get(f.type) ?? 0) + f.n);
  return [...by].map(([type, n]) => ({ type, n }));
}

export type PartyItem = {
  party: string;
  name: string;
  roles: ScoreRow[];
  contracts: number;
  worst: Level;
  red_flag: boolean;
  red_flags: Flag[];
};

/** Hai danh sách theo vai (`GET /partners?role=`) ⇒ các dòng đối tác × vai (vai gắn lại theo danh sách nguồn). */
export function roleRows(
  lists: Partial<Record<PartnerRole, readonly PartnerRow[] | undefined>>,
): ScoreRow[] {
  return ROLES.flatMap((role) => (lists[role] ?? []).map((r) => ({ ...r, role })));
}

/** Một dòng mỗi đối tác (gộp vai), cờ đỏ trước rồi tên; số HĐ từ `contract-counts`. */
export function partiesOf(
  rows: readonly ScoreRow[] | undefined,
  counts: ReadonlyMap<string, number>,
): PartyItem[] {
  const by = new Map<string, ScoreRow[]>();
  for (const r of rows ?? []) by.set(r.party, [...(by.get(r.party) ?? []), r]);
  const items = [...by].map(([party, rs]) => {
    const roles = [...rs].sort(
      (a, b) => REP_ROLE_ORDER.indexOf(a.role) - REP_ROLE_ORDER.indexOf(b.role),
    );
    const red_flags = flagsOf(roles);
    return {
      party,
      name: roles[0]?.name ?? party,
      roles,
      contracts: counts.get(party) ?? 0,
      worst: worstOf(roles),
      red_flag: roles.some((r) => r.red_flag === true),
      red_flags,
    };
  });
  return items.sort(
    (a, b) => Number(b.red_flag) - Number(a.red_flag) || a.name.localeCompare(b.name, "vi"),
  );
}

/** Đối tác cần xem lại (Tổng quan): có cờ đỏ, hoặc mức CHÚ Ý. Cờ đỏ trước, rồi điểm thấp, rồi tên. */
export function partnersToReview(rows: readonly ScoreRow[] | undefined): ScoreRow[] {
  const score = (p: ScoreRow) => p.score ?? 101;
  return (rows ?? [])
    .filter((p) => p.red_flag === true || p.band === "watch")
    .sort(
      (a, b) =>
        Number(b.red_flag === true) - Number(a.red_flag === true) ||
        score(a) - score(b) ||
        a.name.localeCompare(b.name, "vi"),
    );
}

/** Top đối tác theo vai — nhiều việc đã ghi nhất, cùng số việc: điểm cao hơn trước; tối đa `max`. */
export function topPartners(
  rows: readonly ScoreRow[] | undefined,
  role: RepRole,
  max = 3,
): ScoreRow[] {
  return (rows ?? [])
    .filter((p) => p.role === role && p.event_count > 0)
    .sort(
      (a, b) =>
        b.event_count - a.event_count ||
        (b.score ?? 0) - (a.score ?? 0) ||
        a.name.localeCompare(b.name, "vi"),
    )
    .slice(0, max);
}

// ---------- cách tính điểm (`/scoring/:role`) ----------
type Criterion = { enabled: boolean; weight: number };
/** Tổng trọng số các tiêu chí đang bật; server đòi đúng 100 (422 nếu khác). */
export const weightSum = (cs: readonly Criterion[]): number =>
  cs.filter((c) => c.enabled).reduce((s, c) => s + c.weight, 0);

/** Lỗi sơ bộ trước khi gửi (key i18n sau `contracts.settings.score.err.`), null = ổn. Server vẫn là nguồn quyết định. */
export function scoringIssue(
  cs: readonly Criterion[],
  r: {
    good_from: number;
    fair_from: number;
    min_events: number;
    window_months: number;
    recency_months: number;
  },
): "sum" | "order" | "min" | "window" | null {
  if (weightSum(cs) !== 100) return "sum";
  if (!(r.fair_from > 0 && r.fair_from < r.good_from && r.good_from <= 100)) return "order";
  if (!(r.min_events >= 0 && r.min_events <= 100)) return "min";
  if (!(r.window_months >= 1 && r.window_months <= 60)) return "window";
  if (!(r.recency_months >= 1 && r.recency_months <= r.window_months)) return "window";
  return null;
}

// ---------- REP-v3-ui · engine V2-E: quy đổi dòng `/reputation/*` về dòng chung ----------
const BANDS: readonly ScoreBand[] = ["good", "fair", "watch"];

/** Một dòng `/reputation/partners` ⇒ dòng chung: mức MỚI có điểm ⇒ "MỚI · tạm tính", không điểm ⇒ "–"; cờ đỏ giữ nguyên (tách khỏi điểm). */
export function fromRep(r: RepPartnerRow): ScoreRow {
  const band = BANDS.find((b) => b === r.level) ?? null;
  const fresh = r.level === "new";
  return {
    party: r.party,
    name: r.name,
    role: r.role,
    score: band ? r.score : null,
    band,
    reason: "",
    event_count: r.jobs,
    adjust: 0,
    contracts: 0,
    provisional: fresh && r.score !== null,
    provisional_score: fresh ? r.score : null,
    red_flag: r.red_flag === true,
    ...(r.red_flags ? { red_flags: r.red_flags } : {}),
  };
}

/** TQ-04: dòng "Cần chú ý" — thêm lý do (cờ đỏ · CHÚ Ý · giảm điểm) và số điểm đã giảm so với kỳ chốt 3 tháng trước. */
export type AttentionItem = ScoreRow & {
  reasons: RepAttentionRow["reasons"];
  drop: number | null;
  before: number | null;
};
export const fromAttention = (r: RepAttentionRow): AttentionItem => ({
  ...fromRep(r),
  reasons: r.reasons,
  drop: r.drop,
  before: r.before,
});
