// HUB-FR-68 · Q7 · D6 · tenant đang bật cho ô `Phạm vi` (dùng lại `tenantsQuery` của Orchestrator).
import { useQuery } from "@tanstack/react-query";
import { tenantsQuery } from "#/features/orchestrator/api";

export function useScopeTenants() {
  const q = useQuery(tenantsQuery);
  const tenants = (q.data ?? []).filter((x) => x.active).map((x) => ({ id: x.id, name: x.name }));
  return { tenants, loading: q.isPending, error: q.isError };
}
