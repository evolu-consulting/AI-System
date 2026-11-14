// M1D-FR-02 · M1D-FR-03 · M1D-FR-04: cơ cấu tổ chức — `/admin/org*` + `/admin/groups*` (admin-api, proxy cùng origin) và chế độ
// thấy `/pack/contracts/visibility` (hub-api). Hình dữ liệu = `@ai/contracts` (org.ts).
import type { OrgMembersResponse, OrgResponse } from "@ai/contracts/org";
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
export const fetchVisibility = (signal?: AbortSignal) =>
  api<{ mode: VisibilityMode }>("/pack/contracts/visibility", { signal });
export const putVisibility = (mode: VisibilityMode) =>
  api<{ mode: VisibilityMode }>("/pack/contracts/visibility", { method: "PUT", body: { mode } });

/** CR-151 · trang thành viên (tìm + phân trang ở máy chủ). */
export function fetchOrgMembers(q: string, offset: number, limit: number, signal?: AbortSignal) {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q) qs.set("q", q);
  return api<OrgMembersResponse>(`/admin/org/members?${qs}`, { signal });
}
export async function fetchOrgPeoplePage(q: string, offset: number, signal?: AbortSignal) {
  const r = await fetchOrgMembers(q, offset, 50, signal);
  const end = offset + r.items.length;
  return {
    items: r.items.map((m) => ({ id: m.user_id, name: m.display_name })),
    next: end < r.total ? end : null,
  };
}
