// CR-139d · CR-189 · gọi API cơ cấu tổ chức `/admin/org*`: đọc một lần, sửa trực tiếp trên sơ đồ (tạo/đổi tên/chuyển/xoá phòng,
// thêm-bớt thành viên). Kết quả các lời gọi ghi mang đủ dữ liệu để Hoàn tác (tên cũ, phòng cũ, phòng cha được đưa về).
import type {
  DeptCreateResponse,
  DeptMemberRemoveResponse,
  DeptMembersAddResponse,
  DeptRenameResponse,
  OrgResponse,
} from "@ai/contracts/org";
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
  const dept = (gid: string) => `/admin/org/departments/${id(gid)}`;
  return {
    refresh,
    /** Đổi trưởng phòng và/hoặc phòng cha (`parent_group_id` vắng = giữ nguyên, null = lên công ty). */
    setDept: (
      gid: string,
      body: { head_user_id: string | null; parent_group_id?: string | null },
    ) => api(dept(gid), { method: "PUT", body, ...q(tenantId) }),
    /** CR-147b ý 9 · chức vụ nhân viên (rỗng = xoá). */
    setTitle: (uid: string, job_title: string | null) =>
      api(`/admin/org/members/${id(uid)}/title`, {
        method: "PUT",
        body: { job_title },
        ...q(tenantId),
      }),
    createDept: (name: string, parent_group_id: string | null) =>
      api<DeptCreateResponse>("/admin/org/departments", {
        method: "POST",
        body: { name, parent_group_id },
        ...q(tenantId),
      }),
    renameDept: (gid: string, name: string) =>
      api<DeptRenameResponse>(`${dept(gid)}/name`, {
        method: "PUT",
        body: { name },
        ...q(tenantId),
      }),
    addMembers: (gid: string, user_ids: string[]) =>
      api<DeptMembersAddResponse>(`${dept(gid)}/members`, {
        method: "POST",
        body: { user_ids },
        ...q(tenantId),
      }),
    removeMember: (gid: string, uid: string) =>
      api<DeptMemberRemoveResponse>(`${dept(gid)}/members/${id(uid)}`, {
        method: "DELETE",
        ...q(tenantId),
      }),
    removeDept: (gid: string) => api(dept(gid), { method: "DELETE", ...q(tenantId) }),
  };
}

export type OrgApi = ReturnType<typeof useOrgApi>;
