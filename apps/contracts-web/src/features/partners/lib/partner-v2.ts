// V2-I · U3 · luật thuần của Đối tác UI: tham số URL, lọc HĐ theo giai đoạn, ghi chú từ kết quả internet. Điểm/cờ đỏ: `partner-score.ts`.
import type { PartnerContractRow, PartnerRole, PartnerWebLine } from "@ai/contracts";

/** Hai vai có điểm (engine HD8). Vai "bên trả hoa hồng" tính như Khách hàng (CR-097 Q3). */
export const ROLES: readonly PartnerRole[] = ["supplier", "customer"];
export const TABS = ["overview", "contracts", "review"] as const;
export type Tab = (typeof TABS)[number];

export type PartnersSearch = { party?: string; role?: PartnerRole; tab?: Tab };
const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;

/** Tham số URL của `/partners`: có `party` ⇒ trang chi tiết; giá trị lạ bị bỏ; mặc định (tab tổng quan) không ghi. */
export function parsePartnersSearch(s: Record<string, unknown>): PartnersSearch {
  const party = text(s.party, 300);
  if (!party) return {};
  const role = ROLES.find((r) => r === s.role);
  const tab = s.tab === "contracts" || s.tab === "review" ? s.tab : undefined;
  return { party, ...(role ? { role } : {}), ...(tab ? { tab } : {}) };
}
// ---------- HĐ (DT-06) ----------
export const STAGES = ["all", "not_started", "in_progress", "done"] as const;
export type StageFilter = (typeof STAGES)[number];
export function stageCounts(rows: readonly PartnerContractRow[]): Record<StageFilter, number> {
  const c: Record<StageFilter, number> = {
    all: rows.length,
    not_started: 0,
    in_progress: 0,
    done: 0,
  };
  for (const r of rows) c[r.stage] += 1;
  return c;
}
export const byStage = (
  rows: readonly PartnerContractRow[],
  f: StageFilter,
): PartnerContractRow[] => (f === "all" ? [...rows] : rows.filter((r) => r.stage === f));

// ---------- tìm internet (DT-07) ----------
/** Dòng kết quả ⇒ nội dung ghi chú (≤ 2000 ký tự): "Tiêu đề: tóm tắt (nguồn)". */
export function noteOfLine(l: PartnerWebLine): string {
  const body = l.summary ? `${l.title}: ${l.summary}` : l.title;
  return (l.source ? `${body} (${l.source})` : body).slice(0, 2000);
}
