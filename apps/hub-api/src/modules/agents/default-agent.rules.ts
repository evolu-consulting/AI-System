// HUB-FR-77 · CR-054: tin không tag ở Hỏi AI đi vào agent mặc định của tenant (`hub.tenant_agent_defaults`). Thuần.
// Tenant chưa cấu hình ⇒ `legacy` (Orchestrator như trước, không cần grant). Đã cấu hình:
// · agent mặc định là Orchestrator ⇒ chỉ cần entitlement của tenant (Orchestrator không cấp quyền riêng — H3b-R04 giữ
//   nguyên; dùng được = cả công ty); `noMatch` theo cấu hình, agent dự phòng phải nằm trong AU của người gửi.
// · agent thường ⇒ run `direct` nếu nằm trong AU của người gửi (bật ∧ entitlement ∧ grant user/group/tenant).
// · còn lại ⇒ `forbidden` (`DEFAULT_AGENT_FORBIDDEN`), không tạo run.
import {
  type AgentConfig,
  type ConfigSnapshot,
  pickOrchestrator,
  type TenantAgentDefaults,
} from "../config/config.rules";
import {
  type AccessSubject,
  accessInput,
  type HubAgentRef,
  orchestratorIds,
  visibleAgents,
} from "./agent-access.rules";

/** Khi Orchestrator không thấy agent nào khớp. */
export type NoMatchPolicy =
  | { kind: "answer" }
  | { kind: "ask" }
  | { kind: "fallback"; agent: HubAgentRef };

export type DefaultRoute =
  | { kind: "legacy" }
  | { kind: "orchestrator"; noMatch: NoMatchPolicy }
  | { kind: "direct"; agent: AgentConfig }
  | { kind: "forbidden" };

const entitled = (s: ConfigSnapshot, agentId: string, tenantId: string): boolean =>
  s.entitlements.some(
    (e) => e.agentId === agentId && e.tenantId === tenantId && e.revokedAt === null,
  );

/** Mặc định là Orchestrator: đúng bản chạy cho T + entitlement; dự phòng chỉ khi nằm trong AU của người gửi. */
function orchestratorRoute(
  s: ConfigSnapshot,
  who: AccessSubject,
  agent: AgentConfig,
  d: TenantAgentDefaults,
): DefaultRoute {
  if (pickOrchestrator(s, who.tenantId)?.config.agentId !== agent.id) return { kind: "forbidden" };
  if (!entitled(s, agent.id, who.tenantId)) return { kind: "forbidden" };
  const visible = visibleAgents(accessInput(s, who));
  const fb = d.fallbackAgentId ? visible.find((v) => v.id === d.fallbackAgentId) : undefined;
  if (d.onNoMatch === "fallback" && fb)
    return { kind: "orchestrator", noMatch: { kind: "fallback", agent: fb } };
  return { kind: "orchestrator", noMatch: { kind: d.onNoMatch === "ask" ? "ask" : "answer" } };
}

export function defaultRoute(s: ConfigSnapshot, who: AccessSubject): DefaultRoute {
  const d = s.tenantDefaults?.get(who.tenantId);
  if (!d) return { kind: "legacy" };
  const agent = s.agents.find((a) => a.id === d.defaultAgentId);
  if (!agent?.enabled) return { kind: "forbidden" };
  if (orchestratorIds(s).has(agent.id)) return orchestratorRoute(s, who, agent, d);
  const visible = visibleAgents(accessInput(s, who));
  return visible.some((v) => v.id === agent.id) ? { kind: "direct", agent } : { kind: "forbidden" };
}
