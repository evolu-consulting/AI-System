// CR-122 · P8 · chèn một bước vào GIỮA một cạnh của sơ đồ (nút "+" trên cạnh). Thuần.
// Bước mới nằm ngay sau bước nguồn (cạnh Đúng/Sai: ngay trước bước đích); mọi đích sau khi chèn đánh lại bằng `remapStepRefs`
// (đã áp ở đây ⇒ nơi gọi KHÔNG remap lần nữa). Cạnh Đúng/Sai ⇒ nhánh đó trỏ vào bước mới, bước mới đi tiếp tới đích cũ.
import type { StageDraft } from "./draft-types";
import { insertStepAfter, type StepOpResult } from "./step-ops";
import { remapStepRefs } from "./step-refs";

export type EdgeRef = { from: string; to: string; side?: "yes" | "no" };

/** Chèn `fresh` vào cạnh `e`; trả mảng ĐÃ đánh lại đích. Lỗi (đủ số giai đoạn / cạnh không còn) ⇒ `error`. */
export function insertOnEdge<T extends StageDraft>(
  stages: readonly T[],
  fresh: T,
  e: EdgeRef,
): StepOpResult<T> {
  const src = stages.find((s) => s.uid === e.from);
  const dst = stages.find((s) => s.uid === e.to);
  if (!src || !dst) return { error: "process.admin.canvas.err.stagesMax" };
  const after = e.side ? Math.max(src.step, dst.step - 1) : src.step;
  const r = insertStepAfter(stages, after, fresh);
  if ("error" in r) return r;
  const mapped = remapStepRefs(stages, r.stages);
  const newStep = mapped.find((s) => s.uid === fresh.uid)?.step ?? after + 1;
  const dstStep = mapped.find((s) => s.uid === e.to)?.step ?? newStep + 1;
  // Nguồn có `next_step` tường minh trỏ đúng đích của cạnh ⇒ cạnh này là next_step đó.
  const viaNext = !e.side && mapped.find((s) => s.uid === e.from)?.nextStep === dstStep;
  const out = mapped.map((s) => {
    // Nhánh Đúng/Sai hoặc next_step tường minh ⇒ bước mới tự đi tiếp tới đích cũ (không rơi sang bước kế).
    if (s.uid === fresh.uid) return e.side || viaNext ? { ...s, nextStep: dstStep } : s;
    if (s.uid !== e.from) return s;
    if (e.side) return { ...s, ifx: { ...s.ifx, [e.side]: newStep + 1 } };
    return viaNext ? { ...s, nextStep: newStep } : s;
  });
  return { stages: out };
}
