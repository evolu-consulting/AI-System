// M1D-FR-02 · M1D-FR-03 · M1D-FR-04: cơ cấu tổ chức — `/admin/org*` + `/admin/groups*` (admin-api, proxy cùng origin) và chế độ
// thấy `/pack/contracts/visibility` (hub-api). Hình dữ liệu = `@ai/contracts` (org.ts).
import type { OrgResponse } from "@ai/contracts/org";
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
