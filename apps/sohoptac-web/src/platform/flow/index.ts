// CR-118 · cr118-flow-web · cửa vào duy nhất của `platform/flow` (feature chỉ import từ đây).
export { flowRuntime, httpFlowRuntime } from "./adapters/http";
export { flowViewKey, useFlowSubmitForm, useFlowSummary, useFlowView } from "./hooks/use-flow";
export type { FlowRuntime } from "./port";
export { packOfSlot } from "./port";
export { FlowPanel, FlowPanelBody, type FlowPanelProps, type FlowPanelState } from "./ui/FlowPanel";
export { RENDERERS, rendererFor } from "./ui/registry";
export { StepFrame } from "./ui/StepRow";
export {
  type AnyStepProps,
  FlowFormError,
  type StepComponent,
  type StepContext,
  type StepOverrides,
  type StepProps,
  type StepRenderers,
} from "./ui/types";
