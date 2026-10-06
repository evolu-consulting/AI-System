// ADM-FR-37 · ADM-FR-36 · CR-043 · gọi Hub `/agent-grants*` (nơi duy nhất của feature hub). Bearer + refresh 1 lần qua `api()`.
// `tenantId` chỉ truyền khi người dùng là platform_admin (tenant_admin: Hub tự lấy tenant từ JWT).
import type { AgentGrantListResponse, EffectiveAgentsResponse } from "@ai/contracts/hub-admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

export const HUB_KEYS = {
  all: ["hub"] as const,
  groupGrants: (groupId: string, tenantId?: string) =>
    ["hub", "agent-grants", "group", groupId, tenantId ?? ""] as const,
  effectiveAll: ["hub", "effective"] as const,
  effective: (userId: string, tenantId?: string) =>
    ["hub", "effective", userId, tenantId ?? ""] as const,
};

/** `hubUrl` chỉ null khi chưa cấu hình — mọi hook đã chặn bằng `enabled`; lọt qua thì ném lỗi rõ thay vì gọi nhầm origin admin. */
const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};

/** Mọi agent của tenant kèm grant của đúng group này (`grants.length > 0` ⇔ đã cấp). */
export function useGroupAgentGrants(groupId: string, tenantId?: string) {
  return useQuery({
    queryKey: HUB_KEYS.groupGrants(groupId, tenantId),
    enabled: hubConfigured(),
    queryFn: () =>
      api<AgentGrantListResponse>(url("/agent-grants"), {
        query: { tenant_id: tenantId, subject_type: "group", subject_id: groupId },
      }),
  });
}

export type GroupGrantChange = { agentId: string; groupId: string; grant: boolean };

/** POST (cấp) / DELETE (thu hồi) — cả hai idempotent phía Hub. Xong → quyền hiệu lực phải tính lại. */
export function useSetGroupAgentGrant(tenantId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, groupId, grant }: GroupGrantChange) =>
      grant
        ? api<unknown>(url("/agent-grants"), {
            method: "POST",
            query: { tenant_id: tenantId },
            body: { agent_id: agentId, subject_type: "group", subject_id: groupId },
          })
        : api<undefined>(url("/agent-grants"), {
            method: "DELETE",
            query: {
              tenant_id: tenantId,
              agent_id: agentId,
              subject_type: "group",
              subject_id: groupId,
            },
          }),
    onSettled: () => qc.invalidateQueries({ queryKey: HUB_KEYS.effectiveAll }),
  });
}

/** Quyền agent hiệu lực của một user (`staleTime 0`: luôn hỏi lại khi mở). */
export function useEffectiveAgents(userId: string | undefined, tenantId?: string) {
  return useQuery({
    queryKey: HUB_KEYS.effective(userId ?? "", tenantId),
    enabled: hubConfigured() && !!userId,
    staleTime: 0,
    queryFn: () =>
      api<EffectiveAgentsResponse>(url(`/agent-grants/effective/${userId}`), {
        query: { tenant_id: tenantId },
      }),
  });
}
