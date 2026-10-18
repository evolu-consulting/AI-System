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
