// ADM-FR-62 · M3-R13 · bộ lọc Group của Users: `?group=<key>` → id (danh sách group của tenant, ≤ 200, plan-frontend D16).
// Key lạ (hoặc nằm ngoài 200 mục đầu) → bỏ lọc và hiện chip; platform chưa chọn tenant → ô lọc khoá.
import { useGroupOptions } from "@/features/groups/api";

type Tenant = { isPlatform: boolean; tenantId: string | undefined; ready: boolean };

export function useUsersGroupFilter(groupKey: string | undefined, tn: Tenant, signedIn: boolean) {
  const needsTenant = tn.isPlatform && !tn.tenantId;
  const query = useGroupOptions(tn.tenantId, tn.ready && signedIn && !needsTenant);
  const found = groupKey ? query.data?.find((g) => g.key === groupKey) : undefined;
  return {
    options: query.data,
    id: found?.id,
    key: found?.key,
    unknownKey: groupKey && query.data && !found ? groupKey : undefined,
    disabled: needsTenant,
    /** Có `?group` thì đợi danh sách group để ánh xạ key → id trước khi gọi danh sách user. */
    ready: !groupKey || needsTenant || !!query.data,
  };
}
