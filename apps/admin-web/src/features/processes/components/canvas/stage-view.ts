// ADM-FR-71 · P-b2 (plan-frontend FB5/§6): mô hình hiển thị một giai đoạn cho canvas/StepList — dẫn xuất THUẦN từ bản nháp,
// chỉ chứa thứ cần vẽ (gõ `instruction` không đổi mô hình ⇒ canvas không dựng lại).
import type { EditorRefs } from "../../hooks/use-editor-refs";
import type { DraftErrors, StageDraft } from "../../lib/def-form";

export type StageView = {
  uid: string;
  /** Chỉ số trong mảng (nhãn "Giai đoạn n" = index + 1). */
  index: number;
  step: number;
  name: string;
  executor: string;
  after: "review" | "auto";
  real: boolean;
  backTo: number[];
  /** P-c1 · stage tự-sửa mã (huy hiệu). */
  autofix: boolean;
  hasError: boolean;
};

const hasStageError = (errors: DraftErrors, i: number): boolean =>
  Object.keys(errors).some((k) => k.startsWith(`stages.${i}.`));

export function stageViews(
  stages: readonly StageDraft[],
  errors: DraftErrors,
  refs: Pick<EditorRefs, "agents" | "teams">,
): StageView[] {
  const labels = new Map([...refs.agents, ...refs.teams].map((o) => [o.value, o.label]));
  return stages.map((s, i) => ({
    uid: s.uid,
    index: i,
    step: s.step,
    name: s.name,
    executor: labels.get(s.executor) ?? "",
    after: s.after,
    real: s.real,
    backTo: s.backTo,
    autofix: s.autofix.on,
    hasError: hasStageError(errors, i),
  }));
}

/** Hai mô hình có cùng nội dung hiển thị (dùng cho `memo` của node). */
export const sameView = (a: StageView, b: StageView): boolean =>
  a.uid === b.uid &&
  a.index === b.index &&
  a.step === b.step &&
  a.name === b.name &&
  a.executor === b.executor &&
  a.after === b.after &&
  a.real === b.real &&
  a.autofix === b.autofix &&
  a.hasError === b.hasError &&
  a.backTo.join() === b.backTo.join();
