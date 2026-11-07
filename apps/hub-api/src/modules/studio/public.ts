// ADR-0037 · cửa công khai DUY NHẤT của module `studio`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export { changedFields } from "./agents/agents.map";
export type { AgentDbRow } from "./agents/agents.port";
export {
  agentHooks,
  agentKhIds,
  bumpAgentVersion,
  readAgent,
  replaceAgentHooks,
  workflowsByIds,
} from "./agents/agents.port";
export type { AgentsService } from "./agents/agents.service";
export { agentDetail } from "./agents/agents.service";
export type { EntitlementsService } from "./entitlements/entitlements.service";
export type { StudioAudit, StudioWriteDeps } from "./studio-write";
export { withConfigWrite } from "./studio-write";
