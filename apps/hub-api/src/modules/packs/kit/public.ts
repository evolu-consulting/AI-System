// Cửa công khai của kit gói cho module khác (ADR-0037): registry nhãn bản ghi + registry mục hàng việc của menu + kiểu.

export { createDocxConverter } from "./adapters/docx/index";
export { pgExternalOrgResolver } from "./adapters/ext-org.pg";
export { externalFirewall } from "./adapters/external-firewall.middleware";
export { flowRoutes } from "./adapters/flow.routes";
export { flowPortRegistry } from "./adapters/flow-port-registry";
export { packMeRoutes } from "./adapters/me.route";
export { memberNamesOf, selfContactOf } from "./adapters/member-names";
export { packMembersRoutes } from "./adapters/members.route";
export { createModuleRegistry, moduleRegistry } from "./adapters/module-registry";
export {
  constToolArgs,
  type NodeConfigIssue,
  type NodeConfigValidator,
  nodeConfigRegistry,
} from "./adapters/node-config-registry";
export type { PackBell } from "./adapters/pack-bell";
export { packBell } from "./adapters/pack-bell";
export type { PackFileboxClient } from "./adapters/pack-files.filebox";
export { createPackFiles, packFilesRepo } from "./adapters/pack-files.filebox";
export { packFilesRoutes } from "./adapters/pack-files.routes";
export { packGroups } from "./adapters/pack-groups";
export type { PackAccessView, PackGuardVars } from "./adapters/pack-guard.middleware";
export {
  packAccessInput,
  packEnabled,
  packGuard,
  packGuardOrPlatform,
  requestWho,
  tenantFeatureOn,
} from "./adapters/pack-guard.middleware";
export { packHosts } from "./adapters/pack-hosts";
export { packNavRoutes } from "./adapters/pack-nav.route";
export { packNavRegistry } from "./adapters/pack-nav-registry";
export { withPackRoleInTx } from "./adapters/pack-role-in-tx";
export { PackToolRegistry } from "./adapters/pack-tools.registry";
export { createPackUow, packTenantOnly } from "./adapters/pack-uow";
export { createPdfConverter } from "./adapters/pdf/index";
export { recordLabelRegistry } from "./adapters/record-label-registry";
export { shadowEmit } from "./adapters/shadow-emit";
export { checkSlotContract, flowAdapterSlots } from "./adapters/slot-contract.check";
export { slotRegistry } from "./adapters/slot-registry";
export type {
  ActivityRow,
  ActivitySource,
  ActivityWindow,
  RecordHistory,
} from "./application/activity.ports";
export type { ContextLabeler, ContextSource } from "./application/context.ports";
export type { ExtDirectory, ExternalOrgResolver } from "./application/ext-org.ports";
export type { FlowActError, FlowActOutcome, FlowSlotAdapter } from "./application/flow.ports";
export { flowRuntime, flowRuntimeOn } from "./application/flow.ports";
export type {
  FactsReader,
  FlowEventInput,
  FlowFacts,
  FlowFactValue,
  OutcomeHandler,
  OutcomeInput,
  OutcomeResult,
} from "./application/flow-events.ports";
export type { KitTxRepos } from "./application/index-outbox";
export type {
  EventBinding,
  ModuleRegistry,
  ModuleVerifyOpts,
  NodeBinding,
} from "./application/module.ports";
export type { Notifier, NotifyInput, NotifyTxRepos } from "./application/notify";
export { orgForTenant } from "./application/pack-files.ports";
export type { PackNavCap, PackNavRegistry, PackNavSource } from "./application/pack-nav.ports";
export type { OwnedRunOutcome } from "./application/pack-run-outcome.usecase";
export { ownedRunOutcome } from "./application/pack-run-outcome.usecase";
export type {
  PackActTarget,
  PackModuleOutcome,
  PackOpenRun,
  PackOpenTask,
  PackReviewAct,
  PackRunCaller,
  PackRunOutcome,
  PackRunOutcomeSys,
  PackRunRef,
  PackRunRequest,
  PackRunSlot,
  PackRunsBridge,
  PackRunsPort,
  PackStepsView,
  PackStepView,
  PackWorkflow,
} from "./application/pack-runs.ports";
export type {
  PackToolArgs,
  PackToolCatalog,
  PackToolCtx,
  PackToolDef,
} from "./application/pack-tools.ports";
export type { PackSystemUow, PackUow, PackWho } from "./application/ports";
export type { RecordLabelRegistry, RecordLabelSource } from "./application/record-label.ports";
export type {
  ResolvedSlot,
  RoutedSlot,
  RouteSlotFacts,
  SlotField,
  SlotIssue,
  SlotSpec,
} from "./application/slot.ports";
export { slotFields, slotNodes } from "./application/slot.ports";
export type { StartPackRunDeps, StartPackRunResult } from "./application/start-pack-run.usecase";
export { startPackRun } from "./application/start-pack-run.usecase";
export type { DocxConverter } from "./domain/docx.rules";
export { externalPackActions } from "./domain/external-access.rules";
export { checkPackAccess, packActionsFor } from "./domain/pack-access.rules";
export { PackToolBusinessError } from "./domain/pack-tool-error";
export type { PdfConverter, PdfResult } from "./domain/pdf.rules";
