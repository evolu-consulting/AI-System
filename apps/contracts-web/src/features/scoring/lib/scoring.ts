// HD8-FR-03 · luật thuần của trang Cách tính điểm — port `mgmt-app/web/src/pages/settings/ScoringPage.tsx:12-69,209`: tổng trọng số
// tiêu chí bật, bản nháp đã đổi chưa, tiêu chí có sẵn khôi phục được, tiêu chí tự chấm còn thêm được, lên/xuống mức.
import type { Criterion, ScoreBand, ScoreConfigOut, ScoringDraft } from "@ai/contracts";

export const MAX_CRITERIA = 12;
export type Draft = { criteria: Criterion[]; rules: ScoringDraft["rules"] };

/** Ô số: chỉ chữ số, trần 100. */
export const toInt = (s: string) => Math.min(100, Number(s.replace(/\D/g, "")) || 0);

export const totalOf = (d: Draft | null) =>
  d?.criteria.filter((c) => c.enabled).reduce((s, c) => s + c.weight, 0) ?? 0;

export const isDirty = (d: Draft | null, cfg: ScoreConfigOut | undefined) =>
  !!cfg &&
  !!d &&
  JSON.stringify(d) !== JSON.stringify({ criteria: cfg.criteria, rules: cfg.rules });

/** Tiêu chí có sẵn không còn trong bản nháp: đã xoá trước (máy chủ) hoặc vừa xoá (còn trong cấu hình đã lưu). */
export function restorableOf(d: Draft, cfg: ScoreConfigOut | undefined) {
  const have = new Set(d.criteria.map((c) => c.key));
  const all = [
    ...(cfg?.criteria ?? [])
      .filter((c) => c.kind === "auto")
      .map((c) => ({ key: c.key, label: c.label, weight: c.weight })),
    ...(cfg?.restorable ?? []),
  ];
  return all.filter((r, i) => !have.has(r.key) && all.findIndex((x) => x.key === r.key) === i);
}

/** Tiêu chí tự chấm còn chọn được (theo tên, không gõ tự do). */
export const choicesOf = (d: Draft, cfg: ScoreConfigOut | undefined) => {
  const labels = new Set(d.criteria.map((c) => c.label));
  return (cfg?.manual_choices ?? []).filter((x) => !labels.has(x));
};

/** Mức thấp → cao; chưa có mức xếp thấp nhất. */
const RANK: Record<string, number> = { watch: 1, fair: 2, good: 3 };
export const wentUp = (oldBand: ScoreBand | null, newBand: ScoreBand) =>
  (RANK[newBand] ?? 0) > (RANK[oldBand ?? ""] ?? 0);
