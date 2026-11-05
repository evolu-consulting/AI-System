// CR-118 · cr118-flow-web · registry renderer theo `FlowStepKind` (spec §5). `RENDERERS: StepRenderers` thiếu loại ⇒ lỗi typecheck;
// mỗi loại là một chunk lazy riêng (route giữ dưới trần 50 KB). Loại lạ (snapshot cũ) ⇒ `GenericStep`. Khe của gói có thể thay
// renderer của từng loại bằng `overrides` (đồng bộ).
import type { FlowStepKind } from "@ai/contracts/flow";
import { type ComponentType, lazy } from "react";
import { GenericStep } from "./StepRow";
import type { AnyStepProps, StepOverrides, StepRenderers } from "./types";

const Default = () => import("./StepRow");

export const RENDERERS: StepRenderers = {
  review: lazy(Default),
  dify: lazy(Default),
  esign: lazy(Default),
  wait: lazy(Default),
  system: lazy(Default),
  form: lazy(() => import("./FormStep")),
};

/** Renderer của loại `kind` (override của khe > registry > GenericStep cho loại lạ). */
export function rendererFor(
  kind: string,
  overrides: StepOverrides | undefined,
  map: StepRenderers = RENDERERS,
): ComponentType<AnyStepProps> {
  const own =
    overrides && Object.hasOwn(overrides, kind) ? overrides[kind as FlowStepKind] : undefined;
  const found = Object.hasOwn(map, kind) ? map[kind as FlowStepKind] : undefined;
  return (own ?? found ?? GenericStep) as ComponentType<AnyStepProps>;
}
