// CR-118 · @ai/flow-canvas · registry loại bước: MỖI `FlowStepKind` của @ai/contracts có một mục (thiếu loại ⇒ lỗi typecheck).
// Loại lạ (vd bước DLC: kind riêng của engine DLC, không có trong contract) ⇒ `genericStepKind`: vẫn vẽ node bước, không huy hiệu.
import type { FlowStepKind } from "@ai/contracts/flow";

/** Huy hiệu loại bước trên node (huy hiệu "conditional" do bố cục thêm theo điều kiện, không theo loại). */
export type KindBadge = "esign" | "dify";
export type StepKindSpec = { badge: KindBadge | null };

export const STEP_KINDS: { readonly [K in FlowStepKind]: StepKindSpec } = {
  review: { badge: null },
  dify: { badge: "dify" },
  esign: { badge: "esign" },
  form: { badge: null },
  wait: { badge: null },
  system: { badge: null },
  agent: { badge: null }, // CR-120 G1
};

/** Loại không có trong contract (DLC…): vẽ chung. */
export const genericStepKind: StepKindSpec = { badge: null };

export function stepKindSpec(kind: string): StepKindSpec {
  return Object.hasOwn(STEP_KINDS, kind) ? STEP_KINDS[kind as FlowStepKind] : genericStepKind;
}
