// CR-118 · cr118-flow-web · cửa vào duy nhất của `platform/flow` (feature chỉ import từ đây).
export { claimTask, reassignTask, releaseTask } from "./adapters/claim";
export { flowRuntime, httpFlowRuntime } from "./adapters/http";
export { flowViewKey, useFlowSubmitForm, useFlowSummary, useFlowView } from "./hooks/use-flow";
export { claimView, cr127ErrorKey, whoOf } from "./lib/claim";
export type { EvidenceDraft, EvidenceRule } from "./lib/evidence";
export { EMPTY_EVIDENCE, evidenceBody, evidenceIssue, evidenceRuleOf } from "./lib/evidence";
export type { FlowRuntime } from "./port";
export { packOfSlot } from "./port";
export { ClaimBar } from "./ui/ClaimBar";
export { EvidenceAsk } from "./ui/EvidenceAsk";
export { EvidenceInput } from "./ui/EvidenceInput";
export { FlowPanel, FlowPanelBody, type FlowPanelProps, type FlowPanelState } from "./ui/FlowPanel";
export type { Person } from "./ui/ReassignBox";
export { decisionTaskOf, RunStepActions, type RunStepActionsProps } from "./ui/RunStepActions";
export { RENDERERS, rendererFor } from "./ui/registry";
export { SignaturePad } from "./ui/SignaturePad";
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
