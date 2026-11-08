// CR-125 · cr125-subprocess-ui · danh sách quy trình có thể làm "quy trình con" của công ty đang sửa. NGUỒN: danh sách flow của công ty
// (`GET /tenants/:id/company-flows`, gồm flow Thư viện được GÁN lẫn bản công ty); platform sửa Thư viện (không có công ty) ⇒ `process-defs` kèm bản Thư viện.
// Dùng chung cho panel (ô chọn) và ô trên canvas (tên quy trình con, số bước). Cùng khoá query với các trang khác ⇒ không gọi thêm.
import { useEffect, useMemo } from "react";
import { useCompanyFlowList } from "@/features/tenants/flows/company-flows-api";
import { useSession } from "@/lib/auth/use-session";
import { useProcessDefs } from "../../../api";
import { useFlowCtx } from "../../../components/flow/flow-ctx";
import { type ChildSource, childSourceOfFlow } from "../../../lib/subprocess-form";

/** Trần số trang tự nạp thêm (50 mục / trang) — đủ cho công ty cỡ lớn, không nạp vô hạn. */
const MAX_PAGES = 6;

export function useChildDefs(): {
  items: ChildSource[];
  isLoading: boolean;
  tenantId: string | undefined;
} {
  const flow = useFlowCtx();
  const me = useSession((s) => s.me);
  const isPlatform = me?.role === "platform_admin";
  const tenantId = flow?.tenantId;
  // công ty của lượt sửa: platform chọn (`flow.tenantId`), quản trị công ty = công ty của phiên
  const tid = tenantId ?? (isPlatform ? undefined : me?.tenant.id);
  const flows = useCompanyFlowList(tid ?? "", !!tid);
  const defs = useProcessDefs(tenantId, tenantId === undefined && isPlatform, !tid);
  const pages = defs.data?.pages.length ?? 0;
  useEffect(() => {
    if (!tid && defs.hasNextPage && !defs.isFetchingNextPage && pages < MAX_PAGES)
      void defs.fetchNextPage();
  }, [tid, defs.hasNextPage, defs.isFetchingNextPage, defs.fetchNextPage, pages]);
  const items = useMemo<ChildSource[]>(
    () =>
      tid
        ? (flows.data?.items ?? []).map(childSourceOfFlow)
        : (defs.data?.pages.flatMap((p) => p.items) ?? []),
    [tid, flows.data, defs.data],
  );
  // `tenantId` trả ra = tham số `tenant_id` của Hub (chỉ platform truyền; quản trị công ty để Hub lấy từ JWT)
  return { items, isLoading: tid ? flows.isLoading : defs.isLoading, tenantId };
}

/** Mục danh sách của quy trình con theo khoá; chưa chọn / chưa nạp / không còn ⇒ undefined. */
export function useChild(defKey: string | undefined): {
  item: ChildSource | undefined;
  tenantId: string | undefined;
} {
  const { items, tenantId } = useChildDefs();
  const item = defKey ? items.find((d) => d.key === defKey) : undefined;
  return { item, tenantId };
}
