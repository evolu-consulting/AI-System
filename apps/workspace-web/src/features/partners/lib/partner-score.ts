// U3 · CR-097a (R33–R46) · điểm đối tác theo engine HD8 (`/partners`): hai vai ⇒ dòng đối tác × vai, khối "đối tác cần xem lại" của Tổng quan,
// top theo số việc, kiểm sơ bộ cách tính. CR-151e: mức/huy hiệu, cờ đỏ, gộp vai, `fromRep` dùng CHUNG với máy chủ (`@ai/contracts/pack-contracts`).
import type {
  PartnerRole,
  PartnerRow,
  RepAttentionRow,
  RepRole,
  ScoreRow,
} from "@ai/contracts/pack-contracts";
import { fromRep } from "@ai/contracts/pack-contracts";
import { ROLES } from "./partner-v2";

export {
  type Badge,
  badgeOf,
  type Flag,
  type FlagType,
  flagsOf,
  fromRep,
  type Level,
  type PartyItem,
  partiesOf,
  type ScoreRow,
  worstOf,
} from "@ai/contracts/pack-contracts";

/** Hai danh sách theo vai (`GET /partners?role=`) ⇒ các dòng đối tác × vai (vai gắn lại theo danh sách nguồn). */
export function roleRows(
  lists: Partial<Record<PartnerRole, readonly PartnerRow[] | undefined>>,
): ScoreRow[] {
  return ROLES.flatMap((role) => (lists[role] ?? []).map((r) => ({ ...r, role })));
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

// ---------- REP-v3-ui · engine V2-E ----------
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
