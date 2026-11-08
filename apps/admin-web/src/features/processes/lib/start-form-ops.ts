// CR-125 · cr125-manual-start-ui · thêm/gỡ node «Phiếu yêu cầu» ở ĐẦU flow (đẩy bước, đánh lại đích bước). Thuần.
import { START_FORM_NODE_KEY } from "@ai/contracts/modules";
import type { StageDraft } from "./draft-types";
import { withNodeDefaults } from "./node-defaults";
import { emptyStage } from "./stage-convert";
import { addStartField, emptyStartForm, type StartFormDraft } from "./start-form";
import { insertStepAfter } from "./step-ops";
import { remapStepRefs } from "./step-refs";
/** Mẫu tên mặc định: «<tên flow> {{ô đầu}}» khi chưa đặt — dùng ô đầu tiên. */
export const defaultTitleTemplate = (name: string, d: StartFormDraft): string => {
  const first = d.fields[0];
  return first ? `${name} {{${first.key}}}`.trim() : name;
};

/** Node «Phiếu yêu cầu» mới (đầu flow): 1 ô mẫu, ai trong công ty cũng bắt đầu được. */
export function freshStartStage(a: {
  name: string;
  fieldLabel: string;
  flowName: string;
}): StageDraft {
  const form = addStartField(emptyStartForm(), a.fieldLabel);
  const base: StageDraft = {
    ...emptyStage(),
    key: "phieu",
    keyAuto: false,
    name: a.name,
    executor: "set",
    node: START_FORM_NODE_KEY,
    startForm: { ...form, title: defaultTitleTemplate(a.flowName, form) },
  };
  return withNodeDefaults(base, []);
}

export const hasStartForm = (stages: readonly StageDraft[]): boolean =>
  stages.some((s) => s.node === START_FORM_NODE_KEY);

/** Đặt node phiếu ở ĐẦU flow (bước 0, đẩy các bước khác lùi một, đánh lại đích bước). Đã có / hết chỗ ⇒ không đổi. */
export function addStartFormFirst(
  stages: readonly StageDraft[],
  fresh: StageDraft,
): { stages: StageDraft[] } | { error: string } {
  if (hasStartForm(stages)) return { stages: [...stages] };
  const taken = stages.map((s) => s.key);
  const key = taken.includes(fresh.key) ? `${fresh.key}-2` : fresh.key;
  const r = insertStepAfter(stages, -1, { ...fresh, key });
  if ("error" in r) return { error: r.error };
  return { stages: remapStepRefs(stages, r.stages) };
}

/** Gỡ node phiếu: các bước còn lại dồn lên, đích bước đánh lại (đích trỏ vào phiếu ⇒ bỏ). */
export function removeStartForm(stages: readonly StageDraft[]): StageDraft[] {
  const rest = stages.filter((s) => s.node !== START_FORM_NODE_KEY);
  const ranked = [...new Set(rest.map((s) => s.step))].sort((a, b) => a - b);
  const after = rest.map((s) => ({ ...s, step: ranked.indexOf(s.step) }));
  return remapStepRefs(stages, after);
}
