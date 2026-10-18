// HUB-FR-124 · C19 · phần thuần của validate `inputs` lúc start (tách từ `runs/start-inputs.ts`, P-d1 T8s). Lớp 1: không contract.
const DAY_MS = 86_400_000;

type InputDefShape = { type: string; options?: readonly string[] };
type InputValueShape = { type: string; value?: unknown };

/** Khớp hình dạng tĩnh với def (key, type, select∈options). source_ref/file cần DB ⇒ kiểm riêng. */
export function shapeValid(d: InputDefShape | undefined, v: InputValueShape): boolean {
  if (!d || d.type !== v.type) return false;
  if (v.type === "select") return (d.options ?? []).includes(v.value as string);
  return true;
}

/** Hạn run = `now` + `ttlDays` ngày. */
export const expiresAt = (now: Date, ttlDays: number): Date =>
  new Date(now.getTime() + ttlDays * DAY_MS);

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** PD-R13: `YYYY-MM-DD` và là ngày lịch có thật. */
export function isCalendarDate(s: string): boolean {
  const m = ISO_DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export type InputValue = { key: string; type: string; value?: string };

/** Lỗi hình dạng từng input lúc start (thiếu required không phải lỗi — IN-03). `date`: value ISO + ngày thật. */
export function startInputIssues(
  defs: readonly { key: string; type: string; required: boolean; options?: readonly string[] }[],
  values: readonly InputValue[],
): { index: number; path: "value" | "key" | "type" }[] {
  const out: { index: number; path: "value" | "key" | "type" }[] = [];
  for (const [index, v] of values.entries()) {
    const d = defs.find((x) => x.key === v.key);
    if (!d) {
      out.push({ index, path: "key" });
      continue;
    }
    if (d.type !== v.type) {
      out.push({ index, path: "type" });
      continue;
    }
    if (!shapeValid(d, v)) {
      out.push({ index, path: "value" });
      continue;
    }
    if (v.type === "date" && !(typeof v.value === "string" && isCalendarDate(v.value)))
      out.push({ index, path: "value" });
  }
  return out;
}
