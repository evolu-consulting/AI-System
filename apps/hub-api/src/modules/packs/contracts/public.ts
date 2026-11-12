// Cửa công khai của gói contracts cho module khác (ADR-0037): chỉ hằng/kiểu/luật thuần, không re-export toàn bộ.

export { FLOW_ROUTE_NONE, FLOW_ROUTE_UNAVAILABLE } from "./domain/approval-engine.rules";
export { attentionOf } from "./domain/approval-engine-card.rules";
export { APPROVAL_PROCESS_KEY } from "./domain/approval-flow.rules";
export { backTargetOfRun, flowViewOfRun } from "./domain/approval-flow-view.rules";
export { esignEventOf } from "./domain/esign-event.rules";
