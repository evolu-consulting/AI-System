// CR-134 · kiểu hành động của luồng (`FlowActionDef.style`) → biến thể nút chung. Tách file để RunStepActions và EvidenceAsk dùng chung không vòng import.
import type { FlowActionDef } from "@ai/contracts/flow";
import type { BtnVariant } from "~/components/ui/Btn";

export const ACTION_VARIANT: Record<FlowActionDef["style"], BtnVariant> = {
  primary: "primary",
  default: "quiet",
  danger: "danger",
};
