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
import { emptyHistory, record, redo as redoH, undo as undoH } from "../lib/edit-history";
import { type EdgeRef, insertOnEdge } from "../lib/insert-on-edge";
import { duplicateCluster, removeCluster } from "../lib/module-cluster";
import { withNodeDefaults } from "../lib/node-defaults";
import {
  addStageAsNewStep,
  addStageToStep,
  insertStepAfter,
  moveInColumn,
  moveToStep,
  type StepOpResult,
  splitToNewStep,
  swapStepColumns,
} from "../lib/step-ops";
import { remapStepRefs } from "../lib/step-refs";

/** `remap = false` ⇒ phép đã tự đánh lại đích bước (vd `insertOnEdge`), không remap lần hai. */
/** `key` = khoá gộp lịch sử hoàn tác (sửa liên tiếp cùng một ô); vắng ⇒ luôn là một bước riêng. */
type Update = (fn: (d: DefDraft) => DefDraft, remap?: boolean, key?: string) => void;

/** Các thao tác sửa bản nháp (không đụng accordion/lỗi). */
function draftOps(update: Update) {
  return {
    patch: (p: Partial<DefDraft>) => update((d) => ({ ...d, ...p }), true, `def:${Object.keys(p)}`),
    /** `coalesce = false` ⇒ luôn là một bước hoàn tác riêng (vd nối cạnh trên canvas); gõ vào ô thì gộp. */
    patchStage: (i: number, p: Partial<StageDraft>, coalesce = true) =>
      update(
        (d) => ({ ...d, stages: patchStage(d.stages, i, p) }),
        true,
        coalesce ? `stage:${i}:${Object.keys(p)}` : undefined,
      ),
    moveInColumn: (i: number, dir: -1 | 1) =>
      update((d) => ({ ...d, stages: moveInColumn(d.stages, i, dir) })),
    /** dlc-step-library · Lên/Xuống của bước DLC: đổi chỗ cả bước (cột) với bước kề. */
    swapStep: (i: number, dir: -1 | 1) =>
      update((d) => ({ ...d, stages: swapStepColumns(d.stages, i, dir) })),
    /** CR-123 · u3a · xoá một stage của node module ⇒ xoá CẢ cụm (Ký số = gửi + chờ); stage thường ⇒ như cũ. */
    removeStage: (i: number) => update((d) => ({ ...d, stages: removeCluster(d.stages, i) })),
    /** fnr-canvas · lưu `y` của node `uid` (chỉ-UI); `undefined` ⇒ bỏ (về bố cục tự động). */
    setUiY: (uid: string, y: number | undefined) =>
      update((d) => ({
        ...d,
        stages: d.stages.map((s) => {
          if (s.uid !== uid) return s;
          const { uiY: _y, ...rest } = s;
          return y === undefined ? rest : { ...rest, uiY: Math.round(y) };
        }),
      })),
    /** fnr-canvas · "Sắp xếp": xoá mọi `y` đã lưu ⇒ bố cục tự động. */
    clearUiY: () =>
      update((d) => ({
        ...d,
        stages: d.stages.map(({ uiY: _y, ...s }) => s),
      })),
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
    const s = withNodeDefaults(
      emptyStage(),
      ref.current.stages.map((o) => o.key),
    );
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
    /** dlc-engine · thêm giai đoạn dựng sẵn (vd bước DLC từ khung bước DLC có sẵn) thành bước mới cuối. */
    addFresh: (make: (st: readonly StageDraft[]) => StageDraft) => {
      const s = withNodeDefaults(
        make(ref.current.stages),
        ref.current.stages.map((o) => o.key),
      );
      const r = applySteps((st) => addStageAsNewStep(st, s));
      if ("stages" in r) select(s.uid);
      return r;
    },
    /** CR-122 · P8 · chèn giai đoạn dựng sẵn vào giữa một cạnh (đích đã đánh lại bên trong `insertOnEdge`). */
    insertOnEdge: (fresh: StageDraft, e: EdgeRef): StepOpResult<StageDraft> => {
      const r = insertOnEdge(ref.current.stages, fresh, e);
      if ("stages" in r) {
        update((d) => ({ ...d, stages: r.stages }), false);
        select(fresh.uid);
      }
      return r;
    },
    /** CR-123 · p25 · thay cả mảng giai đoạn (thả/xoá/dán/kéo nhóm trên canvas); `remap = false` khi phép đã tự đánh lại đích. */
    setStages: (stages: StageDraft[], remap = true, pickUid?: string) => {
      update((d) => ({ ...d, stages }), remap);
      if (pickUid) select(pickUid);
    },
    /** CR-123 · u3a · sao chép stage `i` KÈM cả cụm node module (bản sao nối tiếp sau cụm gốc, một bước hoàn tác); chọn bản sao đầu. */
    duplicateStage: (i: number): StepOpResult<StageDraft> => {
      const r = duplicateCluster(ref.current.stages, i);
      if ("stages" in r) {
        update((d) => ({ ...d, stages: r.stages }));
        if (r.uids?.[0]) select(r.uids[0]);
      }
      return r;
    },
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
  const hist = useRef(emptyHistory<DefDraft>());
  const update: Update = (fn, remap = true, key) => {
    const prev = ref.current;
    const raw = fn(prev);
    // CR-122 · U2b: đổi/chèn/xoá bước ⇒ đánh lại mọi đích bước (goto, Nếu, Duyệt, gộp, chờ sự kiện) để không trỏ sai.
    const next =
      raw.stages === prev.stages || !remap
        ? raw
        : { ...raw, stages: remapStepRefs(prev.stages, raw.stages) };
    if (next !== prev) hist.current = record(hist.current, prev, key, Date.now());
    ref.current = next;
    setDraft(next);
  };
  /** Hoàn tác / làm lại (CR-123 · p25): trả `true` khi có gì để đổi. */
  const step = (go: typeof undoH): boolean => {
    const r = go(hist.current, ref.current);
    if (!r) return false;
    hist.current = r.h;
    ref.current = r.value;
    setDraft(r.value);
    return true;
  };
  /** Nạp bản mới (lần đầu mở / tải lại sau xung đột): coi là đã lưu, chọn giai đoạn đầu. */
  const load = (d: DefDraft) => {
    hist.current = emptyHistory();
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
    if (uid) pick(uid);
  };
  // fnr-editor-drawer: yêu cầu mở ngăn chi tiết — chỉ khi người dùng chọn / thêm giai đoạn / có lỗi khi Lưu (không phải nạp bản nháp)
  const [openReq, setOpenReq] = useState(0);
  const pick = (uid: string) => {
    setSelected(uid);
    setOpenReq((n) => n + 1);
  };
  const steps = useStepMutations(ref, update, pick);
  return {
    draft,
    draftRef: ref,
    dirty: snapshot(draft) !== base,
    undo: () => step(undoH),
    redo: () => step(redoH),
    canUndo: hist.current.past.length > 0,
    canRedo: hist.current.future.length > 0,
    errors,
    selected,
    select: pick,
    /** Bỏ chọn (đóng ngăn) — không yêu cầu mở lại. */
    deselect: () => setSelected(null),
    openReq,
    load,
    markSaved: () => setBase(snapshot(ref.current)),
    showErrors,
    ...steps,
    ...draftOps(update),
  };
}
export type DraftState = ReturnType<typeof useDraft>;
