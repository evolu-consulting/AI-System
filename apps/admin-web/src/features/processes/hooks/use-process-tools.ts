// HUB-FR-146 · P-d2 (plan-frontend-d2 §10, D2-20): catalog tool khả dụng của công ty đang xem cho khối "Gọi tool". Dùng CHUNG query
// với `use-process-timezone` (`GET /process-editor/context`) ⇒ một request. Component không gọi `api.ts` trực tiếp ⇒ qua hook này.
import type { ProcessToolItem } from "@ai/contracts/hub-admin";
import { useProcessEditorContext } from "../api";
import { useProcessTenant } from "./use-process-tenant";

export function useProcessTools() {
  const tenant = useProcessTenant();
  const q = useProcessEditorContext(tenant.tenantId, tenant.ready);
  return {
    /** `undefined` khi đang tải / lỗi (không kiểm theo catalog); def mẫu ⇒ `[]`. */
    tools: q.data ? (q.data.tools ?? []) : (undefined as readonly ProcessToolItem[] | undefined),
    isPending: q.isPending,
    isError: q.isError,
    refetch: () => void q.refetch(),
    /** Quy trình mẫu (platform_admin chưa chọn công ty): không chọn được tool. */
    isTemplate: tenant.isPlatform && tenant.tenantId === undefined,
  };
}
