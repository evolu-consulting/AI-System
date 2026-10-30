// CR-105 · L3: danh sách tenant để chọn gán quy trình (platform_admin) — bọc `useTenantList` để component không gọi API trực tiếp.
import { useTenantList } from "@/features/tenants/api";

export function useAssignableTenants(enabled: boolean) {
  const q = useTenantList({ q: "" }, enabled);
  return {
    isPending: q.isPending,
    items: (q.data?.items ?? []).filter((t) => t.key !== "platform"),
  };
}
