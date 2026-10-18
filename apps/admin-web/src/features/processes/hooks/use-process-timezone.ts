// ADM-FR-71 · HUB-FR-143 · P-d1: múi giờ công ty của editor (`GET /process-editor/context`) cho khối "Chờ tới ngày".
// Component không gọi `api.ts` trực tiếp (depcruise `component-no-fetch`) ⇒ qua hook này.
import { useProcessEditorContext } from "../api";
import { useProcessTenant } from "./use-process-tenant";

export function useProcessTimezone() {
  const tenant = useProcessTenant();
  const q = useProcessEditorContext(tenant.tenantId, tenant.ready);
  return {
    /** Múi giờ IANA; `undefined` khi đang tải / lỗi. */
    timezone: q.data?.timezone,
    isError: q.isError,
    refetch: () => void q.refetch(),
    /** Quy trình mẫu (platform_admin chưa chọn công ty): tính theo múi giờ của công ty chạy quy trình. */
    isTemplate: tenant.isPlatform && tenant.tenantId === undefined,
  };
}
