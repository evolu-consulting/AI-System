// CHỈ cho test (ADR-0037 `testing/`): int test của module khác (processes) dựng gói contracts thật — mount, tool, usecase, repo.
// Code production không import file này (luật `no-prod-import-testing`); tới đây qua `public.ts` cho phần luật thuần.

export { approvalRepo } from "../adapters/approval.repo";
export { approvalEngineRepo } from "../adapters/approval-engine.repo";
export { contractFlowRepo } from "../adapters/contract-flow.repo";
export { esignRepo } from "../adapters/esign.repo";
export { selfsignProvider } from "../adapters/esign.selfsign";
export { esignNodeValidator } from "../adapters/esign-node.validator";
export { manageRepo } from "../adapters/manage.repo";
export { partnerInboxRepo } from "../adapters/partner-inbox.repo";
export { partnerSendRepo } from "../adapters/partner-send.repo";
export { actApproval, getApproval } from "../application/approval.usecase";
export type { ApprovalEnginePort, EngineStartRequest } from "../application/approval-engine.ports";
export { engineCard } from "../application/approval-engine-card.usecase";
export type { ContractFlowGate } from "../application/contract-flow.ports";
export type { ESignFiles } from "../application/esign.ports";
export { getHistory } from "../application/manage.usecase";
export { flowViewOfCard } from "../domain/approval-flow-view.rules";
export { esignModule } from "../esign.mount";
export { contractsFactsReader, contractsOutcomeHandler } from "../flow-events.mount";
export { intakeSlotSpec, intakeWiring } from "../intake.mount";
// Còn giữ cho test khoá `tests/acceptance/CF/{approval-inbox-count,assign-default-rule}` (dựng def khe duyệt cũ làm dữ liệu).
export { APPROVAL_SLOT, compileSlotStages } from "./approval-slot/approval-slot.rules";
export { startApproval } from "./start-approval";
