// V2-L · bản nháp ↔ API (thuần): dựng trạng thái từ 3 nguồn, chuẩn hoá trọng số về tổng 100 (server đòi đúng 100), so với mặc định
// (chấm cam) và với bản đã lưu (nút Lưu/Bỏ thay đổi), kiểm sơ bộ trước khi gửi. Thân PUT strict ⇒ bỏ trường chỉ-đọc (`custom`, `ord`).
import {
  type BizConfigOut,
  type CompanyOut,
  MST_RE,
  type RepCellConfigIn,
  type RepJobTypesIn,
} from "@ai/contracts";
import {
  CELL_KEYS,
  type Cell,
  type CellKey,
  type Criterion,
  type JobType,
  type RepConfigOut,
  type SettingsData,
  type SettingsState,
} from "./types";

const cellsOf = (c: RepConfigOut["cells"]): SettingsData["cells"] =>
  Object.fromEntries(CELL_KEYS.map((k) => [k, structuredClone(c[k])])) as SettingsData["cells"];
const jobsOf = (xs: RepConfigOut["job_types"]): JobType[] =>
  xs.map(({ key, name, criterion, score }) => ({ key, name, criterion, score }));

/** Ba nguồn API ⇒ trạng thái đã lưu + mặc định (cùng hình) của hộp thoại. */
export function buildState(co: CompanyOut, rep: RepConfigOut, biz: BizConfigOut): SettingsState {
  return {
    saved: {
      company: { ...co.company, approval_enabled: co.approval_enabled },
      cells: cellsOf(rep.cells),
      repSettings: { ...rep.settings },
      jobTypes: jobsOf(rep.job_types),
      biz: structuredClone(biz.config),
    },
    defaults: {
      company: co.defaults,
      cells: cellsOf(rep.defaults.cells),
      repSettings: { ...rep.defaults.settings },
      jobTypes: jobsOf(rep.defaults.job_types),
      biz: structuredClone(biz.defaults),
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

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}
const cellSame = (a: Cell, b: Cell) => same(normCell(a), normCell(b));

export type Changed = {
  company: boolean;
  cells: CellKey[];
  settings: boolean;
  jobTypes: boolean;
  biz: boolean;
};
/** Khác nhau ở phần nào (draft so với `base` = đã lưu hoặc mặc định). */
export function changedParts(d: SettingsData, base: SettingsData): Changed {
  return {
    company: !same(d.company, base.company),
    cells: CELL_KEYS.filter((k) => !cellSame(d.cells[k], base.cells[k])),
    settings: !same(d.repSettings, base.repSettings),
    jobTypes: !same(d.jobTypes, base.jobTypes),
    biz: !same(d.biz, base.biz),
  };
}
export const anyChanged = (c: Changed): boolean =>
  c.company || c.cells.length > 0 || c.settings || c.jobTypes || c.biz;
export const repChanged = (c: Changed): boolean => c.cells.length > 0 || c.settings || c.jobTypes;

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
export const repSettingsIssue = (s: SettingsData["repSettings"]): string | null =>
  s.fair_from >= s.good_from ? "common.order" : null;

/** Lỗi đầu tiên của mọi phần đã đổi (key i18n sau `contracts.settings.`), null = lưu được. */
export function firstIssue(d: SettingsData, ch: Changed): string | null {
  for (const k of ch.cells) {
    const i = cellIssue(d.cells[k]);
    if (i) return i;
  }
  if (ch.company && d.company.own_tax_ids.some((x) => !MST_RE.test(x))) return "co.taxInvalid";
  if (ch.settings) return repSettingsIssue(d.repSettings);
  return null;
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
