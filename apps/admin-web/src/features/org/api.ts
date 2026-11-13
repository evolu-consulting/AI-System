// CR-139d · gọi API cơ cấu tổ chức: `/admin/org*` (phòng ban, trưởng phòng, phòng cha) + `/admin/groups*` (tạo, đổi tên, thành viên).
import type { OrgResponse } from "@ai/contracts/org";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const orgKey = (tenantId: string | undefined) => ["admin-org", tenantId ?? "self"] as const;
const q = (tenantId: string | undefined) => ({ query: { tenant_id: tenantId } });

export const useOrgData = (tenantId: string | undefined) =>
  useQuery({
    queryKey: orgKey(tenantId),
    queryFn: ({ signal }) => api<OrgResponse>("/admin/org", { signal, ...q(tenantId) }),
  });

export function useOrgApi(tenantId: string | undefined) {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: orgKey(tenantId) }),
      qc.invalidateQueries({ queryKey: ["groups"] }),
    ]);
  const id = encodeURIComponent;
  return {
    refresh,
    setDept: (
      gid: string,
      body: { head_user_id: string | null; parent_group_id?: string | null },
    ) => api(`/admin/org/departments/${id(gid)}`, { method: "PUT", body, ...q(tenantId) }),
    removeDept: (gid: string) =>
      api(`/admin/org/departments/${id(gid)}`, { method: "DELETE", ...q(tenantId) }),
    /** Phòng mới = Group mới rồi đánh dấu phòng ban (kèm phòng cha). */
    async createDept(key: string, name: string, parent: string | null) {
      const g = await api<{ id: string }>("/admin/groups", {
        method: "POST",
        body: { key, name: { vi: name }, description: null },
        ...q(tenantId),
      });
      await api(`/admin/org/departments/${id(g.id)}`, {
        method: "PUT",
        body: { head_user_id: null, parent_group_id: parent },
        ...q(tenantId),
      });
    },
    async rename(gid: string, name: string) {
      const g = await api<{ version: number; name: Record<string, string> }>(
        `/admin/groups/${id(gid)}`,
      );
      await api(`/admin/groups/${id(gid)}`, {
        method: "PATCH",
        body: { version: g.version, name: { ...g.name, vi: name } },
      });
    },
    addMember: (gid: string, username: string) =>
      api(`/admin/groups/${id(gid)}/members`, { method: "POST", body: { usernames: [username] } }),
    removeMember: (gid: string, uid: string) =>
      api(`/admin/groups/${id(gid)}/members/${id(uid)}`, { method: "DELETE" }),
  };
}
