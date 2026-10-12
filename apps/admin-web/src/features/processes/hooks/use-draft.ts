// ADM-FR-66 · CR-056 · P-a F5: trạng thái bản nháp của editor — sửa ô, thêm/xoá/đổi chỗ giai đoạn, lỗi theo ô, giai đoạn đang chọn.
import { useRef, useState } from "react";
import {
  type DefDraft,
  type DraftErrors,
  emptyDraft,
  emptyStage,
  patchStage,
  type StageDraft,
  snapshot,
  stageIndexesOf,
} from "../lib/def-form";
import {
  addStageAsNewStep,
  addStageToStep,
  insertStepAfter,
  moveInColumn,
  moveToStep,
  removeStage,
  type StepOpResult,
  splitToNewStep,
} from "../lib/step-ops";

type Update = (fn: (d: DefDraft) => DefDraft) => void;

/** Các thao tác sửa bản nháp (không đụng accordion/lỗi). */
function draftOps(update: Update) {
  return {
    patch: (p: Partial<DefDraft>) => update((d) => ({ ...d, ...p })),
    patchStage: (i: number, p: Partial<StageDraft>) =>
      update((d) => ({ ...d, stages: patchStage(d.stages, i, p) })),
    moveInColumn: (i: number, dir: -1 | 1) =>
      update((d) => ({ ...d, stages: moveInColumn(d.stages, i, dir) })),
    removeStage: (i: number) => update((d) => ({ ...d, stages: removeStage(d.stages, i) })),
  };
}

type Ref = { current: DefDraft };

/** Các phép đổi bước (trả `StepOpResult`); thêm mới ⇒ chọn giai đoạn vừa tạo. */
function useStepMutations(ref: Ref, update: Update, select: (uid: string) => void) {
  /** Áp một phép đổi bước; lỗi ⇒ trả nguyên `error` (không đổi bản nháp). */
  const applySteps = (
    op: (stages: StageDraft[]) => StepOpResult<StageDraft>,
  ): StepOpResult<StageDraft> => {
    const r = op(ref.current.stages);
    if ("stages" in r) update((d) => ({ ...d, stages: r.stages }));
    return r;
  };
  const addWith = (
    op: (st: StageDraft[], fresh: StageDraft) => StepOpResult<StageDraft>,
  ): StepOpResult<StageDraft> => {
    const s = emptyStage();
    const r = applySteps((st) => op(st, s));
    if ("stages" in r) select(s.uid);
    return r;
  };
  return {
    /** Thêm giai đoạn: vào cột `step` (0-based) hoặc, bỏ trống, thành bước mới cuối. */
    addStage: (step?: number) =>
      addWith((st, s) =>
        step === undefined ? addStageAsNewStep(st, s) : addStageToStep(st, step, s),
      ),
    /** Chèn bước mới (một giai đoạn trống) ngay sau bước `step`. */
    addStepAfter: (step: number) => addWith((st, s) => insertStepAfter(st, step, s)),
    moveToStep: (i: number, step: number) => applySteps((st) => moveToStep(st, i, step)),
    splitToNewStep: (i: number) => applySteps((st) => splitToNewStep(st, i)),
  };
}

export function useDraft() {
  const [draft, setDraft] = useState<DefDraft>(emptyDraft);
  const [base, setBase] = useState(() => snapshot(draft));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [selected, setSelected] = useState<string | null>(() => draft.stages[0]?.uid ?? null);
  const ref = useRef(draft);
  ref.current = draft;
  const update = (fn: (d: DefDraft) => DefDraft) => {
    const next = fn(ref.current);
    ref.current = next;
    setDraft(next);
  };
  /** Nạp bản mới (lần đầu mở / tải lại sau xung đột): coi là đã lưu, chọn giai đoạn đầu. */
  const load = (d: DefDraft) => {
    ref.current = d;
    setDraft(d);
    setBase(snapshot(d));
    setErrors({});
    setSelected(d.stages[0]?.uid ?? null);
  };
  /** Gắn lỗi theo ô và chọn giai đoạn đầu tiên có lỗi. */
  const showErrors = (e: DraftErrors) => {
    setErrors(e);
    const first = stageIndexesOf(Object.keys(e))[0];
    const uid = first === undefined ? undefined : ref.current.stages[first]?.uid;
    if (uid) setSelected(uid);
  };
  const steps = useStepMutations(ref, update, setSelected);
  return {
    draft,
    draftRef: ref,
    dirty: snapshot(draft) !== base,
    errors,
    selected,
    select: setSelected,
    load,
    markSaved: () => setBase(snapshot(ref.current)),
    showErrors,
    ...steps,
    ...draftOps(update),
  };
}
export type DraftState = ReturnType<typeof useDraft>;
