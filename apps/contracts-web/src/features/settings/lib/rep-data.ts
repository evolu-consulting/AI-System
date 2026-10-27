// REP-v3-ui · V2-E · cấu hình điểm uy tín ↔ API (thuần): dựng trạng thái từ `GET /reputation/config`, chuẩn hoá trọng số về tổng 100 (server đòi
// đúng 100), so với mặc định (chấm cam) và với bản đã lưu (nút Lưu/Bỏ thay đổi), kiểm sơ bộ trước khi gửi. Thân PUT strict ⇒ bỏ trường chỉ-đọc
// (`custom`, `ord`).
import type { RepCellConfigIn, RepJobTypesIn } from "@ai/contracts";
import { same } from "./data";
import {
  CELL_KEYS,
  type Cell,
  type CellKey,
  type Criterion,
  type JobType,
  type RepConfigFull,
  type RepData,
  type RepState,
} from "./rep-types";

const cellsOf = (c: RepConfigFull["cells"]): RepData["cells"] =>
  Object.fromEntries(CELL_KEYS.map((k) => [k, structuredClone(c[k])])) as RepData["cells"];
const jobsOf = (xs: RepConfigFull["job_types"]): JobType[] =>
  xs.map(({ key, name, criterion, score }) => ({ key, name, criterion, score }));

/** `GET /reputation/config` ⇒ trạng thái đã lưu + mặc định (cùng hình). */
export function buildRep(rep: RepConfigFull): RepState {
  return {
    saved: {
      cells: cellsOf(rep.cells),
      repSettings: { ...rep.settings },
      jobTypes: jobsOf(rep.job_types),
    },
    defaults: {
      cells: cellsOf(rep.defaults.cells),
      repSettings: { ...rep.defaults.settings },
      jobTypes: jobsOf(rep.defaults.job_types),
    },
  };
}
/** Chia `weights` về số nguyên tổng 100 (phần dư lớn nhất trước). Tổng 0 ⇒ giữ nguyên. */
export function normalise(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights;
  const raw = weights.map((w) => (w / sum) * 100);
  const out = raw.map(Math.floor);
  let rest = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    rest--;
  }
  return out;
}

/** Trọng số tiêu chí BẬT về tổng 100 (tiêu chí tắt giữ nguyên số). */
export function normCell(c: Cell): Cell {
  const on = c.criteria.filter((x) => x.enabled);
  const n = normalise(on.map((x) => x.weight));
  let i = 0;
  return { ...c, criteria: c.criteria.map((x) => (x.enabled ? { ...x, weight: n[i++] ?? 0 } : x)) };
}

/** % hiển thị của tiêu chí bật (0 cho tiêu chí tắt). */
export const percentOf = (c: Cell): Record<string, number> =>
  Object.fromEntries(normCell(c).criteria.map((x) => [x.key, x.enabled ? x.weight : 0]));

const cellSame = (a: Cell, b: Cell) => same(normCell(a), normCell(b));

/** Khác nhau ở phần nào (bản nháp so với `base` = đã lưu hoặc mặc định). */
export type RepChanged = { cells: CellKey[]; settings: boolean; jobTypes: boolean };
export const repChangedParts = (d: RepData, base: RepData): RepChanged => ({
  cells: CELL_KEYS.filter((k) => !cellSame(d.cells[k], base.cells[k])),
  settings: !same(d.repSettings, base.repSettings),
  jobTypes: !same(d.jobTypes, base.jobTypes),
});
export const repAnyChanged = (c: RepChanged): boolean =>
  c.cells.length > 0 || c.settings || c.jobTypes;

const clean = (x: Criterion) => ({
  key: x.key,
  label: x.label,
  kind: x.kind,
  ...(x.milestone ? { milestone: x.milestone } : {}),
  ...(x.penalty ? { penalty: x.penalty } : {}),
  weight: x.weight,
  enabled: x.enabled,
});
/** Thân `PUT /reputation/config/cells/:g/:r` (trọng số đã chuẩn hoá tổng 100). */
export const cellBody = (c: Cell): RepCellConfigIn => {
  const n = normCell(c);
  return {
    criteria: n.criteria.map(clean),
    window_months: n.window_months,
    decay: { months: [...n.decay.months], factors: [...n.decay.factors] },
    late_per_day: n.late_per_day,
  };
};
export const jobTypesBody = (xs: JobType[]): RepJobTypesIn => ({
  items: xs.map((x) => ({ ...x })),
});

/** Lỗi sơ bộ của một ô trước khi gửi (null = ổn). Server vẫn kiểm lại và là nguồn quyết định. */
export function cellIssue(c: Cell): string | null {
  const on = c.criteria.filter((x) => x.enabled);
  if (!on.length || on.every((x) => x.weight <= 0)) return "cell.needOne";
  const { months, factors } = c.decay;
  if (months.some((m, i) => m < 1 || m > c.window_months || (i > 0 && m <= (months[i - 1] ?? 0))))
    return "cell.decayMonths";
  if (factors.some((f) => !(f > 0 && f <= 1))) return "cell.decayFactor";
  return null;
}
export const repSettingsIssue = (s: RepData["repSettings"]): string | null =>
  s.fair_from >= s.good_from ? "common.order" : null;

/** Lỗi đầu tiên của mọi phần đã đổi (key i18n sau `contracts.settings.`), null = lưu được. */
export function firstRepIssue(d: RepData, ch: RepChanged): string | null {
  for (const k of ch.cells) {
    const i = cellIssue(d.cells[k]);
    if (i) return i;
  }
  return ch.settings ? repSettingsIssue(d.repSettings) : null;
}

/** Khoá tiêu chí tự thêm từ tên (không dấu, duy nhất trong ô) — server nhận dạng `custom:[a-z0-9-]{1,40}`. */
export function slugKey(label: string, taken: string[]): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "x";
  let key = `custom:${base}`;
  for (let n = 2; taken.includes(key); n++) key = `custom:${base}-${n}`;
  return key;
}
