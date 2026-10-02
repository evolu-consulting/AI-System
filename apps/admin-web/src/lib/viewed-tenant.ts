// ADM-FR-62 · plan-frontend D8 · tenant đang xem: tenant_admin cố định; platform chọn qua URL `?tenant=<mã>` (mã lạ → `unknown`).
// Nhận danh sách tenant làm tham số (hook chỉ phụ thuộc dữ liệu, không import api): mỗi feature tự gọi `useTenantOptions`.
import type { Me } from "@ai/contracts";

export type TenantOptionData = { id: string; key: string };
export type TenantOptionsQuery = { data?: TenantOptionData[] };

export function resolveViewedTenant(
  me: Me | null,
  tenantParam: string | undefined,
  options: TenantOptionsQuery,
) {
  const isPlatform = me?.role === "platform_admin";
  const tenantKey = isPlatform ? (tenantParam ?? null) : (me?.tenant.key ?? null);
  const picked =
    isPlatform && tenantKey ? options.data?.find((o) => o.key === tenantKey) : undefined;
  const unknown = isPlatform && !!tenantKey && !!options.data && !picked;
  return {
    isPlatform,
    tenants: options.data,
    tenantKey,
    // Chỉ platform_admin gửi `tenant_id`; tenant_admin do server suy ra từ phiên.
    tenantId: isPlatform ? picked?.id : undefined,
    unknown,
    ready: isPlatform ? !!options.data && !unknown : true,
  };
}
