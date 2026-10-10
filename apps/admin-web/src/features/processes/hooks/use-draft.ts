// ADM-FR-66 · CR-056 · P-a F5: trạng thái bản nháp của editor — sửa ô, thêm/xoá/đổi chỗ giai đoạn, lỗi theo ô, accordion mở.
import { PROCESS_STAGES_MAX } from "@ai/contracts/hub-admin";
import { useRef, useState } from "react";
import {
  type DefDraft,
  type DraftErrors,
  emptyDraft,
  emptyStage,
  moveStage,
  patchStage,
  type StageDraft,
  snapshot,
  stageIndexesOf,
} from "../lib/def-form";

type Update = (fn: (d: DefDraft) => DefDraft) => void;

/** Các thao tác sửa bản nháp (không đụng accordion/lỗi). */
function draftOps(update: Update) {
  return {
    patch: (p: Partial<DefDraft>) => update((d) => ({ ...d, ...p })),
    patchStage: (i: number, p: Partial<StageDraft>) =>
      update((d) => ({ ...d, stages: patchStage(d.stages, i, p) })),
    moveStage: (i: number, dir: -1 | 1) =>
      update((d) => ({ ...d, stages: moveStage(d.stages, i, dir) })),
    removeStage: (i: number) =>
      update((d) => ({ ...d, stages: d.stages.filter((_, j) => j !== i) })),
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
  const addStage = () => {
    if (ref.current.stages.length >= PROCESS_STAGES_MAX) return;
    const s = emptyStage();
    update((d) => ({ ...d, stages: [...d.stages, s] }));
    setOpen((o) => [...o, s.uid]);
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
    ...draftOps(update),
  };
}
export type DraftState = ReturnType<typeof useDraft>;
