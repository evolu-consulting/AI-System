// M1D-FR-02 · M1D-FR-03 · M1D-FR-04: cơ cấu tổ chức — `/admin/org*` + `/admin/groups*` (admin-api, proxy cùng origin) và chế độ
// thấy `/pack/contracts/visibility` (hub-api). Hình dữ liệu = `@ai/contracts` (org.ts).
import type { OrgResponse } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

export type VisibilityMode = "tenant" | "org";

export const orgKeys = {
  org: ["org"] as const,
  visibility: ["org", "visibility"] as const,
};

export const fetchOrg = (signal?: AbortSignal) => api<OrgResponse>("/admin/org", { signal });
export const setManager = (userId: string, managerId: string | null) =>
  api(`/admin/org/managers/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: { manager_id: managerId },
  });
export const setHead = (groupId: string, headUserId: string | null) =>
  api(`/admin/org/departments/${encodeURIComponent(groupId)}`, {
    method: "PUT",
    body: { head_user_id: headUserId },
  });
export const removeDepartment = (groupId: string) =>
  api(`/admin/org/departments/${encodeURIComponent(groupId)}`, { method: "DELETE" });
/** Phòng ban mới = Group mới (`/admin/groups`) rồi đánh dấu phòng ban (chưa có trưởng phòng). */
export async function createDepartment(key: string, name: string): Promise<void> {
  const g = await api<{ id: string }>("/admin/groups", {
    method: "POST",
    body: { key, name: { vi: name }, description: null },
  });
  await setHead(g.id, null);
}
export const addDeptMember = (groupId: string, username: string) =>
  api(`/admin/groups/${encodeURIComponent(groupId)}/members`, {
    method: "POST",
    body: { usernames: [username] },
  });
export const removeDeptMember = (groupId: string, userId: string) =>
  api(`/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
export const fetchVisibility = (signal?: AbortSignal) =>
  api<{ mode: VisibilityMode }>("/pack/contracts/visibility", { signal });
export const putVisibility = (mode: VisibilityMode) =>
  api<{ mode: VisibilityMode }>("/pack/contracts/visibility", { method: "PUT", body: { mode } });
