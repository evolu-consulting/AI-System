// CR-125 · cr125-subprocess-ui · danh sách quy trình có thể làm "quy trình con" của công ty đang sửa (cùng công ty; platform sửa Thư viện ⇒ cả bản Thư viện).
// Dùng chung cho panel (ô chọn) và ô trên canvas (tên quy trình con, số bước). Cùng khoá query với trang danh sách ⇒ không gọi thêm.
import type { ProcessDefListItem } from "@ai/contracts/hub-admin";
import { useEffect, useMemo } from "react";
import { useSession } from "@/lib/auth/use-session";
import { useProcessDefs } from "../../../api";
import { useFlowCtx } from "../../../components/flow/flow-ctx";

/** Trần số trang tự nạp thêm (50 mục / trang) — đủ cho công ty cỡ lớn, không nạp vô hạn. */
const MAX_PAGES = 6;

export function useChildDefs(): {
  items: ProcessDefListItem[];
  isLoading: boolean;
  tenantId: string | undefined;
} {
  const flow = useFlowCtx();
  const isPlatform = useSession((s) => s.me?.role) === "platform_admin";
  const tenantId = flow?.tenantId;
  const q = useProcessDefs(tenantId, tenantId === undefined && isPlatform, true);
  const pages = q.data?.pages.length ?? 0;
  useEffect(() => {
    if (q.hasNextPage && !q.isFetchingNextPage && pages < MAX_PAGES) void q.fetchNextPage();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage, pages]);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  return { items, isLoading: q.isLoading, tenantId };
}

/** Mục danh sách của quy trình con theo khoá; chưa chọn / chưa nạp / không còn ⇒ undefined. */
export function useChild(defKey: string | undefined): {
  item: ProcessDefListItem | undefined;
  tenantId: string | undefined;
} {
  const { items, tenantId } = useChildDefs();
  const item = defKey ? items.find((d) => d.key === defKey) : undefined;
  return { item, tenantId };
}
