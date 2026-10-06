// HUB-FR-02, HUB-FR-03, HUB-BR-06, HUB-BR-08 · kiểu cache cấu hình + luật thuần (plan H1 §4 Cache, spec H1-R04, R15, R17).
import { ORCHESTRATOR_RUNTIMES } from "@ai/contracts/studio";
import type { EntitlementRow, GrantRow } from "../agents/agent-access.rules";

/** H4a P9/QB1 · runtime được làm Orchestrator — một nguồn với Studio (`@ai/contracts/studio`). */
const ORCH_RUNTIMES: ReadonlySet<string> = new Set(ORCHESTRATOR_RUNTIMES);

export type TenantState = { id: string; active: boolean; maxConcurrentSub: number | null };
export type UserState = {
  id: string;
  tenantId: string;
  active: boolean;
  lockedByTenant: boolean;
  locale: "vi" | "en";
  groupIds: ReadonlySet<string>;
};

export type ProviderConfig = {
  key: string;
  kind: "subscription" | "api";
  vendor: string;
  maxConcurrency: number;
  enabled: boolean;
  devOnly: boolean;
};
export type ProfileStep = { provider_key: string; model: string | null; on: string[] };
export type ProfileConfig = { id: string; key: string; steps: readonly ProfileStep[] };
export type AgentConfig = {
  id: string;
  key: string;
  name: { vi: string; en: string };
  description: string;
  runtime: string;
  agentTypeKey: string | null;
  /** Null với runtime dify-workflow/dify-agent/python (H4a 0010 D2); runner coi profile vắng = `NOT_CONFIGURED`. */
  profileId: string | null;
  systemPrompt: string;
  runtimeOptions: Record<string, unknown>;
  timeoutS: number;
  tokenBudget: number | null;
  enabled: boolean;
  version: number;
};
export type OrchestratorConfig = {
  agentId: string;
  maxSteps: number;
  tokenBudget: number;
  historyN: number;
  onNoMatch: "answer" | "ask";
  version: number;
};

/**
 * Ảnh chụp cấu hình Hub bất biến (H1-R15): run giữ tham chiếu tới ảnh lúc bắt đầu và ghi `runs.config_version = version`;
 * nạp lại tạo ảnh mới, không sửa ảnh cũ.
 */
export type ConfigSnapshot = Readonly<{
  version: number;
  providers: readonly ProviderConfig[];
  profiles: readonly ProfileConfig[];
  agents: readonly AgentConfig[];
  orchestrator: OrchestratorConfig | null;
  entitlements: readonly EntitlementRow[];
  grants: readonly GrantRow[];
  /** H2a · `hub.agent_workflows`: agent id → workflow id gắn (tool MCP, R18–R19). */
  agentWorkflows: ReadonlyMap<string, ReadonlySet<string>>;
  /** H2b-R13 · `orchestrator_settings` có `tenant_id`: tenant id → bản Orchestrator riêng. */
  orchestratorTenants: ReadonlyMap<string, OrchestratorConfig>;
}>;

/** Workflow gắn agent (rỗng khi không có). */
export function agentWorkflowIds(s: ConfigSnapshot, agentId: string): ReadonlySet<string> {
  return s.agentWorkflows.get(agentId) ?? new Set<string>();
}

export type OrchestratorProblem =
  | "missing_settings"
  | "missing_agent"
  | "disabled"
  | "not_agentic_cli";

/** HUB-BR-08: null = hợp lệ; ngược lại lý do hub-api không được lên. */
export function orchestratorProblem(s: ConfigSnapshot): OrchestratorProblem | null {
  if (!s.orchestrator) return "missing_settings";
  const id = s.orchestrator.agentId;
  const agent = s.agents.find((a) => a.id === id);
  if (!agent) return "missing_agent";
  if (!agent.enabled) return "disabled";
  if (!ORCH_RUNTIMES.has(agent.runtime)) return "not_agentic_cli";
  return null;
}

export type PickedOrchestrator = {
  config: OrchestratorConfig;
  tenantId: string | null;
  invalid: boolean;
};

/**
 * HUB-FR-62 · H2b-R14: bản tenant hợp lệ (agent ∈ `s.agents` ∧ bật ∧ runtime `agentic-cli` — như `orchestratorProblem`,
 * REVIEW 1 Hub #3) → bản đó, kể cả khi mặc định thiếu; bản tenant hỏng
 * → mặc định + `invalid` (service log `orchestrator_tenant_invalid`); null chỉ khi không có bản tenant hợp lệ ∧ mặc
 * định thiếu (spec-decisions "WRITE — QW-R chốt").
 */
export function pickOrchestrator(s: ConfigSnapshot, tenantId: string): PickedOrchestrator | null {
  const own = s.orchestratorTenants.get(tenantId);
  if (
    own &&
    s.agents.some((a) => a.id === own.agentId && a.enabled && ORCH_RUNTIMES.has(a.runtime))
  ) {
    return { config: own, tenantId, invalid: false };
  }
  if (!s.orchestrator) return null;
  return { config: s.orchestrator, tenantId: null, invalid: own !== undefined };
}

/** H1-R04: tenant khoá / user không hoạt động / bị tenant khoá / không thuộc tenant → không được dùng Hub. */
export function accountUsable(
  tenant: TenantState | undefined,
  user: UserState | undefined,
): boolean {
  if (!tenant || !user) return false;
  return tenant.active && user.active && !user.lockedByTenant && user.tenantId === tenant.id;
}
