// HUB-FR-77 · HUB-FR-78 · CR-054 · gọi Hub `/agent-settings*`, `/agent-grants` và Admin `/admin/users` cho màn Agents (nơi duy nhất).
// `tenantId` chỉ truyền khi người dùng là platform_admin (tenant_admin: Hub/Admin tự lấy tenant từ JWT).
import type { GroupListResponse, UserListResponse } from "@ai/contracts";
import type {
  AgentDefaults,
  AgentGrantListResponse,
  AgentSettingsResponse,
  AgentSettingsWriteResponse,
} from "@ai/contracts/hub-admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HUB_KEYS } from "@/features/hub/api";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";
import type { GrantChange } from "./lib/grant-draft";

export const AGENT_KEYS = {
  all: ["agents"] as const,
  settings: (tenantId?: string) => ["agents", "settings", tenantId ?? ""] as const,
  grants: (tenantId?: string) => ["agents", "grants", tenantId ?? ""] as const,
  users: (tenantId?: string) => ["agents", "users", tenantId ?? ""] as const,
  groups: (tenantId?: string) => ["agents", "groups", tenantId ?? ""] as const,
};

/** `hubUrl` chỉ null khi chưa cấu hình — hook đã chặn bằng `enabled`; lọt qua thì ném lỗi rõ. */
const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};

export function useAgentSettings(tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: AGENT_KEYS.settings(tenantId),
    enabled: enabled && hubConfigured(),
    queryFn: () =>
      api<AgentSettingsResponse>(url("/agent-settings"), { query: { tenant_id: tenantId } }),
  });
}

/** Mọi agent của tenant kèm mọi grant (cột "Ai được dùng" + ngăn Cấp quyền). */
export function useTenantAgentGrants(tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: AGENT_KEYS.grants(tenantId),
    enabled: enabled && hubConfigured(),
    queryFn: () =>
      api<AgentGrantListResponse>(url("/agent-grants"), { query: { tenant_id: tenantId } }),
  });
}

/** Nhóm của tenant cho ngăn Cấp quyền (≤ 200, kèm số thành viên cho dòng tóm tắt). */
export function useAgentGroupOptions(tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: AGENT_KEYS.groups(tenantId),
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api<GroupListResponse>("/admin/groups", {
        query: { tenant_id: tenantId, limit: 200 },
      });
      return res.items.map((g) => ({ id: g.id, name: g.name, member_count: g.member_count }));
    },
  });
}

/** Người dùng đang hoạt động của tenant cho ngăn Cấp quyền (≤ 200). */
export function useAgentUserOptions(tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: AGENT_KEYS.users(tenantId),
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api<UserListResponse>("/admin/users", {
        query: { tenant_id: tenantId, status: "active", limit: 200 },
      });
      return res.items.map((u) => ({ id: u.id, username: u.username, name: u.display_name }));
    },
  });
}

export function usePutAgentDefaults(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentDefaults) =>
      api<AgentSettingsWriteResponse>(url("/agent-settings/default"), {
        method: "PUT",
        query: { tenant_id: tenantId },
        body,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: AGENT_KEYS.settings(tenantId) }),
  });
}

export function usePutAgentEntitlement(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { agent_id: string; entitled: boolean }) =>
      api<AgentSettingsWriteResponse>(url("/agent-settings/entitlements"), {
        method: "PUT",
        query: { tenant_id: tenantId },
        body,
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: AGENT_KEYS.all });
      void qc.invalidateQueries({ queryKey: HUB_KEYS.all });
    },
  });
}

export type GrantSave = { agentId: string; add: GrantChange[]; remove: GrantChange[] };

/** Lưu ngăn Cấp quyền: thêm trước (không lúc nào mất quyền), rồi thu hồi; POST/DELETE đều idempotent. */
export function useSaveAgentGrants(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ agentId, add, remove }: GrantSave) => {
      for (const c of add) {
        await api<unknown>(url("/agent-grants"), {
          method: "POST",
          query: { tenant_id: tenantId },
          body: { agent_id: agentId, ...c },
        });
      }
      for (const c of remove) {
        await api<undefined>(url("/agent-grants"), {
          method: "DELETE",
          query: { tenant_id: tenantId, agent_id: agentId, ...c },
        });
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: AGENT_KEYS.grants(tenantId) });
      void qc.invalidateQueries({ queryKey: HUB_KEYS.all });
    },
  });
}
