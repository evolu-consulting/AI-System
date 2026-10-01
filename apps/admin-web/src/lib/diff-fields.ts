// ADM-FR-55 · M3-R20 · diff theo trường cho ConflictDialog (plan-frontend D4): so hai payload API, chỉ trả trường KHÁC.
// Khoá phẳng `description.vi`, `args[1].default`; bỏ khoá hệ thống ở cấp ngoài cùng; `null` và thiếu coi như bằng nhau.

export type DiffRow = {
  path: string;
  mine: string;
  latest: string;
  mineEmpty: boolean;
  latestEmpty: boolean;
};
export type DiffResult = { rows: DiffRow[]; more: number };

/** Số dòng tối đa hiển thị; phần còn lại báo bằng `more` (`conflict.diff.more`). */
export const DIFF_MAX_ROWS = 50;
const SYSTEM_KEYS = new Set(["version", "updated_at", "updated_by", "created_at", "id"]);

type Flat = Map<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function walk(value: unknown, path: string, out: Flat): void {
  if (Array.isArray(value) && value.length > 0) {
    for (let i = 0; i < value.length; i++) walk(value[i], `${path}[${i}]`, out);
  } else if (isObject(value) && Object.keys(value).length > 0) {
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, out);
  } else {
    out.set(path, value ?? null);
  }
}

function flatten(root: unknown): Flat {
  const out: Flat = new Map();
  if (!isObject(root)) return out;
  for (const [k, v] of Object.entries(root)) if (!SYSTEM_KEYS.has(k)) walk(v, k, out);
  return out;
}

/** Giá trị hiển thị: chuỗi có nháy (`"en"`), số/bool thô, null → "". Mảng/đối tượng rỗng → `[]`/`{}`. */
export function formatDiffValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[]";
  if (isObject(v)) return "{}";
  return String(v);
}

const same = (a: unknown, b: unknown) => Object.is(a ?? null, b ?? null);

function toRow(path: string, a: unknown, b: unknown): DiffRow {
  const mine = formatDiffValue(a);
  const latest = formatDiffValue(b);
  return { path, mine, latest, mineEmpty: mine === "", latestEmpty: latest === "" };
}

export function diffFields(mine: unknown, latest: unknown): DiffResult {
  const a = flatten(mine);
  const b = flatten(latest);
  const paths = [...new Set([...a.keys(), ...b.keys()])];
  const rows = paths
    .filter((p) => !same(a.get(p), b.get(p)))
    .map((p) => toRow(p, a.get(p), b.get(p)));
  return { rows: rows.slice(0, DIFF_MAX_ROWS), more: Math.max(0, rows.length - DIFF_MAX_ROWS) };
}
