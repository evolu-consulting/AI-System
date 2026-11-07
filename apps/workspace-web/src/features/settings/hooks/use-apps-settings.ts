// CR-118 §6 · §11.2 · truy vấn của mục "Ứng dụng & quy trình" (component không gọi API trực tiếp).
// CR-123 U2 (FLOW3-FR-11): chỉ đọc — luật chọn quy trình sửa ở admin Công ty › Quy trình; hook lưu luật đã gỡ.
import { useQuery } from "@tanstack/react-query";
import { useSession } from "~/features/auth/hooks/use-session";
import { isCompanyAdmin } from "~/features/shell/lib/nav";
import { appsKeys, fetchCapabilities, fetchRouting } from "../api-apps";

/** Mục chỉ hiện cho quản trị công ty + chủ gói (thành viên/đối tác không thấy). */
export function useCanSeeApps(owner: boolean): { tenantId: string | null; visible: boolean } {
  const me = useSession((s) => s.me);
  const id = me?.tenant.id ?? null;
  const visible = owner && id !== null && isCompanyAdmin(me?.role);
  /** `tenantId` chỉ có khi được phép thấy mục (nơi gọi không cần kiểm lại). */
  return { tenantId: visible ? id : null, visible };
}

export function useCapabilities(tenantId: string | null) {
  return useQuery({
    queryKey: appsKeys.caps(tenantId ?? ""),
    queryFn: ({ signal }) => fetchCapabilities(tenantId as string, signal),
    enabled: tenantId !== null,
    retry: false,
    staleTime: 0,
  });
}

export function useRouting(tenantId: string | null, slot: string) {
  return useQuery({
    queryKey: appsKeys.routing(tenantId ?? "", slot),
    queryFn: ({ signal }) => fetchRouting(tenantId as string, slot, signal),
    enabled: tenantId !== null,
    retry: false,
    staleTime: 0,
  });
}
