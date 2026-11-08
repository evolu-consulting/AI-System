// CHỈ cho test (ADR-0037 `testing/`): int test của module khác (processes) dựng gói contracts thật — mount, tool, usecase, repo.
// Code production không import file này (luật `no-prod-import-testing`); tới đây qua `public.ts` cho phần luật thuần.

export { approvalRepo } from "../adapters/approval.repo";
export { approvalEngineRepo } from "../adapters/approval-engine.repo";
export { approvalEngineTools } from "../adapters/approval-engine.tools";
export { contractFlowRepo } from "../adapters/contract-flow.repo";
export { esignRepo } from "../adapters/esign.repo";
export { selfsignProvider } from "../adapters/esign.selfsign";
export { esignNodeValidator } from "../adapters/esign-node.validator";
export { manageRepo } from "../adapters/manage.repo";
export { partnerInboxRepo } from "../adapters/partner-inbox.repo";
export { partnerSendRepo } from "../adapters/partner-send.repo";
export { actApproval, getApproval, startApproval } from "../application/approval.usecase";
export type { ApprovalEnginePort, EngineStartRequest } from "../application/approval-engine.ports";
export { startEngineApproval } from "../application/approval-engine.usecase";
export { engineCard } from "../application/approval-engine-card.usecase";
export { slotFlowOf } from "../application/approval-engine-slot";
export type { ContractFlowGate } from "../application/contract-flow.ports";
export type { ESignFiles } from "../application/esign.ports";
export { withFlowResend } from "../application/flow-resend.usecase";
export { getHistory } from "../application/manage.usecase";
export { approvalSlotSpec } from "../approval.mount";
export { flowViewOfCard } from "../domain/approval-flow-view.rules";
export { esignModule } from "../esign.mount";
export { contractsFactsReader, contractsOutcomeHandler } from "../flow-events.mount";
export { intakeSlotSpec, intakeWiring } from "../intake.mount";
