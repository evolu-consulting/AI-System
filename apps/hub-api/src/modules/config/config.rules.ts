// HUB-FR-02, HUB-FR-03, HUB-BR-06, HUB-BR-08 · kiểu cache cấu hình + luật thuần (plan H1 §4 Cache, spec H1-R04, R15, R17).
import type { EntitlementRow, GrantRow } from "../agents/agent-access.rules";

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
  profileId: string;
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
}>;

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
  if (agent.runtime !== "agentic-cli") return "not_agentic_cli";
  return null;
}

/** H1-R04: tenant khoá / user không hoạt động / bị tenant khoá / không thuộc tenant → không được dùng Hub. */
export function accountUsable(
  tenant: TenantState | undefined,
  user: UserState | undefined,
): boolean {
  if (!tenant || !user) return false;
  return tenant.active && user.active && !user.lockedByTenant && user.tenantId === tenant.id;
}
