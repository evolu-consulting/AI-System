// ADM-FR-37 · R02 · tenant đích gửi Hub qua `?tenant_id=` CHỈ khi là platform_admin; tenant_admin để Hub lấy từ JWT.
import { useSession } from "@/lib/auth/use-session";

export function useHubTenant(tenantId: string | undefined): string | undefined {
  const role = useSession((s) => s.me?.role);
  return role === "platform_admin" ? tenantId : undefined;
}
