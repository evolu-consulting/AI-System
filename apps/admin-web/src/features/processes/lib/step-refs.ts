// CR-122 · U2b · FLOW2-FR-12: đích bước (`goto`, `then/else`, `reject/return`, `next_step`, `wait_event.branches`) hub nhận theo SỐ BƯỚC
// (0-based), không theo khoá ⇒ mọi phép chèn / kéo / xoá bước phải đánh lại các đích đó. `backTo` đã do `normalizeSteps` remap nên
// KHÔNG đụng ở đây. Thuần: so bản nháp trước/sau theo `uid` để suy ra "bước cũ → bước mới".
import type { StageDraft } from "./draft-types";

type Stage = Pick<StageDraft, "uid" | "step">;

/** Bước cũ → bước mới: lấy stage đầu tiên (theo thứ tự mảng) còn tồn tại ở mỗi bước cũ. Bước cũ không còn stage nào ⇒ không có mục. */
export function stepMap(before: readonly Stage[], after: readonly Stage[]): Map<number, number> {
  const now = new Map(after.map((s) => [s.uid, s.step]));
  const out = new Map<number, number>();
  for (const s of before) {
    const to = now.get(s.uid);
    if (to !== undefined && !out.has(s.step)) out.set(s.step, to);
  }
  return out;
}

const same = (m: Map<number, number>): boolean => [...m].every(([a, b]) => a === b);

/** Đổi một đích 0-based; đích cũ biến mất ⇒ `null` (hiện "chưa chọn" để người dùng chọn lại, không âm thầm trỏ sai). */
const to0 = (v: number | null | undefined, m: Map<number, number>): number | null =>
  v === null || v === undefined ? null : (m.get(v) ?? null);

/** Đích đếm từ 1 như UI (`goto`, `yes`, `no`): đổi qua số bước 0-based rồi trả lại; mất ⇒ null. */
const to1 = (v: number | null, m: Map<number, number>): number | null => {
  const n = to0(v === null ? null : v - 1, m);
  return n === null ? null : n + 1;
};

/** Đổi mọi đích bước của MỘT giai đoạn theo bảng `m` (bước cũ → mới; không có trong bảng ⇒ đích bị bỏ). */
export function remapOne(s: StageDraft, m: Map<number, number>): StageDraft {
  const out: StageDraft = { ...s };
  out.branch = s.branch.map((r) => ({ ...r, goto: to1(r.goto, m) }));
  out.ifx = { ...s.ifx, yes: to1(s.ifx.yes, m), no: to1(s.ifx.no, m) };
  if (s.approve) out.approve = { reject: to0(s.approve.reject, m), ret: to0(s.approve.ret, m) };
  const n = to0(s.nextStep, m);
  if (n === null) delete out.nextStep;
  else out.nextStep = n;
  if (s.set.rows.some((r) => r.step !== null))
    out.set = { rows: s.set.rows.map((r) => ({ ...r, step: to0(r.step, m) })) };
  if (s.wait.branches)
    out.wait = {
      ...s.wait,
      branches: s.wait.branches.map((b) => ({ ...b, step: to0(b.step, m) })),
    };
  return out;
}

/** Áp phép đổi bước lên mọi đích của bản nháp mới; không đổi bước nào ⇒ trả nguyên mảng (không tạo bản sao). */
export function remapStepRefs<T extends StageDraft>(
  before: readonly T[],
  after: readonly T[],
): T[] {
  const m = stepMap(before, after);
  const olds = new Set(before.map((s) => s.step)).size;
  if (same(m) && m.size === olds) return after as T[];
  return after.map((s) => remapOne(s, m) as T);
}
