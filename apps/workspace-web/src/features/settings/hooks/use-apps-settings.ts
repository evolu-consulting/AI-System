// CR-118 §6 · §11.2 · truy vấn + lưu của mục "Ứng dụng & quy trình" (component không gọi API trực tiếp).
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import {
  type RoutingErrorSpec,
  type RuleDraft,
  routingErrorOf,
  toPutBody,
} from "@ai/web-kit/routing-rules";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "~/features/auth/hooks/use-session";
import { fetchOrg, orgKeys } from "~/features/org/api";
import { isCompanyAdmin } from "~/features/shell/lib/nav";
import { appsKeys, fetchCapabilities, fetchRouting, putRouting } from "../api-apps";

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

/** Phòng ban của công ty (`/admin/org`), dùng cho ô chọn phòng ban của luật. */
export function useDepartments(enabled: boolean) {
  return useQuery({
    queryKey: orgKeys.org,
    queryFn: ({ signal }) => fetchOrg(signal),
    enabled,
    retry: false,
    select: (o) => o.departments.map((d) => ({ id: d.group_id, name: d.name })),
  });
}

export type SaveResult = { ok: true; data: ProcessRouting } | { ok: false; spec: RoutingErrorSpec };

/** Lưu cả danh sách luật của một khe (thay thế, kèm `version`). */
export function useSaveRouting(tenantId: string, slot: string) {
  const qc = useQueryClient();
  return async (version: number, drafts: readonly RuleDraft[]): Promise<SaveResult> => {
    const key = appsKeys.routing(tenantId, slot);
    try {
      const data = await putRouting(tenantId, slot, toPutBody(version, drafts));
      qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: appsKeys.caps(tenantId) });
      return { ok: true, data };
    } catch (e) {
      // 409: KHÔNG làm tươi ngầm (mất bản nháp đang sửa); editor hiện "Tải lại" để người dùng tự lấy bản mới.
      return { ok: false, spec: routingErrorOf(e) };
    }
  };
}
