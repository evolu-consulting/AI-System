// HUB-FR-104 · P-b2 (plan-frontend FB6): phép đổi cấu trúc BƯỚC của bản nháp — hàm thuần, canvas/panel/StepList cùng gọi.
// Bất biến sau mỗi phép: mảng không giảm theo `step`, bước liên tục 0,1,2…, `backTo` đã remap + chỉ trỏ bước < bước stage.
import { PROCESS_STAGES_MAX, PROCESS_STEP_STAGES_MAX } from "@ai/contracts/hub-admin";

export type Stepped = { uid: string; step: number; backTo: number[]; after: "review" | "auto" };
export const ERR_STEP_FULL = "process.admin.canvas.err.stepFull";
export const ERR_STAGES_MAX = "process.admin.canvas.err.stagesMax";
export type StepOpError = typeof ERR_STEP_FULL | typeof ERR_STAGES_MAX;
/** `error` ⇒ không đổi gì; `step` = bước (0-based) bị đầy, để nội suy câu lỗi. */
export type StepOpResult<T> = { stages: T[] } | { error: StepOpError; step?: number };

/** Nén bước trống ⇒ liên tục, sắp ổn định theo `step`, remap `backTo`, bỏ đích không còn hợp lệ. */
export function normalizeSteps<T extends Stepped>(stages: readonly T[]): T[] {
  const sorted = [...stages].sort((a, b) => a.step - b.step);
  const keys = [...new Set(sorted.map((s) => s.step))];
  const rank = new Map(keys.map((k, i) => [k, i]));
  return sorted.map((s) => {
    const step = rank.get(s.step) as number;
    const back =
      s.after === "review"
        ? [
            ...new Set(
              s.backTo.flatMap((t) => {
                const r = rank.get(t);
                return r !== undefined && r < step ? [r] : [];
              }),
            ),
          ].sort((a, b) => a - b)
        : [];
    return { ...s, step, backTo: back };
  });
}

/** Số stage ở bước `step`, có thể bỏ qua một stage (đang chuyển đi). */
export const countAtStep = (stages: readonly Stepped[], step: number, skipUid?: string): number =>
  stages.filter((s) => s.step === step && s.uid !== skipUid).length;

export const lastStep = (stages: readonly Stepped[]): number =>
  stages.reduce((m, s) => Math.max(m, s.step), -1);

/** Đặt stage `uid` ở bước (thang cũ, có thể lẻ) `step`, vào ĐẦU cột đích, rồi chuẩn hoá. */
function place<T extends Stepped>(stages: readonly T[], uid: string, step: number): T[] {
  const cur = stages.find((s) => s.uid === uid) as T;
  const rest = stages.filter((s) => s.uid !== uid);
  const at = rest.findIndex((s) => s.step >= step);
  const out = [...rest];
  out.splice(at < 0 ? out.length : at, 0, { ...cur, step });
  return normalizeSteps(out);
}

/** Chuyển stage `i` sang bước `step` (0-based). Quá cuối ⇒ bước mới cuối; âm ⇒ bước 0; bước đích đầy ⇒ lỗi. */
export function moveToStep<T extends Stepped>(
  stages: readonly T[],
  i: number,
  step: number,
): StepOpResult<T> {
  const s = stages[i];
  if (!s) return { stages: [...stages] };
  const last = lastStep(stages);
  const target = Math.min(Math.max(Math.trunc(step), 0), last + 1);
  if (target === s.step) return { stages: [...stages] };
  if (countAtStep(stages, target, s.uid) >= PROCESS_STEP_STAGES_MAX)
    return { error: ERR_STEP_FULL, step: target };
  return { stages: place(stages, s.uid, target) };
}

/** Tách stage `i` ra bước riêng ngay sau cột hiện tại (đã đứng riêng ⇒ không đổi). */
export function splitToNewStep<T extends Stepped>(
  stages: readonly T[],
  i: number,
): StepOpResult<T> {
  const s = stages[i];
  if (!s || countAtStep(stages, s.step) <= 1) return { stages: [...stages] };
  const rest = stages.filter((_, j) => j !== i);
  const after = rest.reduce((m, o, j) => (o.step <= s.step ? j + 1 : m), 0);
  const out = [...rest];
  out.splice(after, 0, { ...s, step: s.step + 0.5 });
  return { stages: normalizeSteps(out) };
}

/** Chỉ số trong mảng của hàng xóm cùng bước theo hướng `dir` (không có ⇒ -1). */
export function columnNeighbor(stages: readonly Stepped[], i: number, dir: -1 | 1): number {
  const j = i + dir;
  return stages[j] && stages[j]?.step === stages[i]?.step ? j : -1;
}

/** Đổi chỗ với hàng xóm cùng bước (hết cột ⇒ không đổi). */
export function moveInColumn<T extends Stepped>(stages: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = columnNeighbor(stages, i, dir);
  const out = [...stages];
  if (j < 0) return out;
  [out[i], out[j]] = [out[j] as T, out[i] as T];
  return out;
}

/** Thêm stage vào CUỐI cột `step` (`step` = bước cuối + 1 ⇒ bước mới). */
export function addStageToStep<T extends Stepped>(
  stages: readonly T[],
  step: number,
  fresh: T,
): StepOpResult<T> {
  if (stages.length >= PROCESS_STAGES_MAX) return { error: ERR_STAGES_MAX };
  const target = Math.min(Math.max(step, 0), lastStep(stages) + 1);
  if (countAtStep(stages, target) >= PROCESS_STEP_STAGES_MAX)
    return { error: ERR_STEP_FULL, step: target };
  const at = stages.reduce((m, o, j) => (o.step <= target ? j + 1 : m), 0);
  const out = [...stages];
  out.splice(at, 0, { ...fresh, step: target, backTo: [] });
  return { stages: normalizeSteps(out) };
}

/** Thêm stage thành bước mới ở cuối. */
export const addStageAsNewStep = <T extends Stepped>(
  stages: readonly T[],
  fresh: T,
): StepOpResult<T> => addStageToStep(stages, lastStep(stages) + 1, fresh);

/** Xoá stage `i`; bước trống bị nén, `backTo` trỏ bước đó bị bỏ. */
export function removeStage<T extends Stepped>(stages: readonly T[], i: number): T[] {
  return normalizeSteps(stages.filter((_, j) => j !== i));
}
