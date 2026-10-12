// ADM-FR-66 · CR-056 · P-a F5: trạng thái bản nháp của editor — sửa ô, thêm/xoá/đổi chỗ giai đoạn, lỗi theo ô, accordion mở.
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

export function useDraft() {
  const [draft, setDraft] = useState<DefDraft>(emptyDraft);
  const [base, setBase] = useState(() => snapshot(draft));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [open, setOpen] = useState<string[]>(() => draft.stages.map((s) => s.uid));
  const ref = useRef(draft);
  ref.current = draft;
  const update = (fn: (d: DefDraft) => DefDraft) => {
    const next = fn(ref.current);
    ref.current = next;
    setDraft(next);
  };
  /** Nạp bản mới (lần đầu mở / tải lại sau xung đột): coi là đã lưu, mở hết giai đoạn. */
  const load = (d: DefDraft) => {
    ref.current = d;
    setDraft(d);
    setBase(snapshot(d));
    setErrors({});
    setOpen(d.stages.map((s) => s.uid));
  };
  /** Đánh dấu bản nháp hiện tại là đã lưu. */
  const markSaved = () => setBase(snapshot(ref.current));
  /** Gắn lỗi theo ô và mở các giai đoạn có lỗi. */
  const showErrors = (e: DraftErrors) => {
    setErrors(e);
    const uids = stageIndexesOf(Object.keys(e)).flatMap((i) => ref.current.stages[i]?.uid ?? []);
    if (uids.length) setOpen((o) => [...new Set([...o, ...uids])]);
  };
  /** Áp một phép đổi bước; lỗi ⇒ trả nguyên `error` (không đổi bản nháp). */
  const applySteps = (
    op: (stages: StageDraft[]) => StepOpResult<StageDraft>,
  ): StepOpResult<StageDraft> => {
    const r = op(ref.current.stages);
    if ("stages" in r) update((d) => ({ ...d, stages: r.stages }));
    return r;
  };
  /** Thêm giai đoạn: vào cột `step` (0-based) hoặc, bỏ trống, thành bước mới cuối. */
  const addStage = (step?: number): StepOpResult<StageDraft> => {
    const s = emptyStage();
    const r = applySteps((st) =>
      step === undefined ? addStageAsNewStep(st, s) : addStageToStep(st, step, s),
    );
    if ("stages" in r) setOpen((o) => [...o, s.uid]);
    return r;
  };
  return {
    draft,
    draftRef: ref,
    dirty: snapshot(draft) !== base,
    errors,
    open,
    setOpen,
    load,
    markSaved,
    showErrors,
    addStage,
    moveToStep: (i: number, step: number) => applySteps((st) => moveToStep(st, i, step)),
    splitToNewStep: (i: number) => applySteps((st) => splitToNewStep(st, i)),
    ...draftOps(update),
  };
}
export type DraftState = ReturnType<typeof useDraft>;
