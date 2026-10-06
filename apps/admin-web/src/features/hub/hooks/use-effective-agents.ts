// ADM-FR-36 · ADM-FR-37 · quyền agent hiệu lực (Hub) → trạng thái trình bày cho AccessExplainer (plan-frontend §2.4).
import type { EffectiveAgentsState } from "@/components/shared/access/AgentSection";
import { hubConfigured } from "@/lib/hub";
import { useEffectiveAgents } from "../api";
import { useHubTenant } from "./use-hub-tenant";

/** `tenantId` = tenant của user được xem (chỉ gửi đi khi là platform_admin). */
export function useEffectiveAgentsState(
  userId: string | undefined,
  tenantId: string | undefined,
): EffectiveAgentsState {
  // Chờ biết tenant của user (platform_admin cần `tenant_id`, thiếu ⇒ Hub trả TENANT_REQUIRED).
  const query = useEffectiveAgents(tenantId ? userId : undefined, useHubTenant(tenantId));
  if (!hubConfigured()) return { status: "unconfigured" };
  if (query.isError) return { status: "error", retry: () => void query.refetch() };
  if (!query.data) return { status: "loading" };
  return { status: "ready", agents: query.data.agents };
}
