// CR-120 · "Một trang Quy trình": gom dữ liệu có sẵn thành một danh sách (không endpoint mới): năng lực → khe, routing mỗi khe
// (tập gán + luật + current_def_id), quy trình công ty tự tạo (`/process-defs` của gói + `kind=sample` bỏ mẫu), tên phòng ban.
import { useMemo, useState } from "react";
import {
  useFlowDepartments,
  useTenantCaps,
  useTenantRoutings,
} from "@/features/tenants/api-routing";
import { useProcessDefs } from "../api";
import {
  assignedRows,
  companyRows,
  type FlowFilter,
  type FlowRow,
  filterFlows,
  NO_FILTER,
  slotsOfCaps,
} from "../lib/flows-view";
import { isTemplateRow } from "../lib/library-view";
import { type LibraryListItem, useLibraryDefs } from "../library-api";

/** `viewTid` = tenant đang xem; `queryTid` = `tenant_id` gửi Hub (chỉ platform_admin). */
export function useFlowsList(
  viewTid: string,
  queryTid: string | undefined,
  isPlatform: boolean,
  enabled: boolean,
) {
  const [filter, setFilter] = useState<FlowFilter>(NO_FILTER);
  const caps = useTenantCaps(viewTid, enabled);
  const refs = useMemo(() => (caps.data ? slotsOfCaps(caps.data) : []), [caps.data]);
  const routings = useTenantRoutings(
    viewTid,
    refs.map((r) => r.slot),
    caps.isSuccess,
  );
  const depts = useFlowDepartments(viewTid, isPlatform, enabled);
  const own = useProcessDefs(queryTid, false, enabled);
  const sample = useLibraryDefs("sample", enabled, queryTid);

  const platformRows = refs.flatMap((ref, i) => {
    const d = routings[i]?.data;
    return d ? assignedRows(ref, d) : [];
  });
  const sampleItems: LibraryListItem[] = sample.data?.pages.flatMap((p) => p.items) ?? [];
  const items = [...(own.data?.pages.flatMap((p) => p.items) ?? []), ...sampleItems].filter(
    (d) => !isTemplateRow(d),
  );
  const all: FlowRow[] = [
    ...platformRows,
    ...companyRows(items, new Set(platformRows.map((r) => r.id))),
  ];
  const templates = sampleItems.filter(isTemplateRow);
  const names = new Map((depts.data ?? []).map((d) => [d.id, d.name]));
  return {
    all,
    rows: filterFlows(all, filter),
    templates,
    filter,
    setFilter,
    deptName: (id: string): string => names.get(id) ?? "",
    loading: own.isPending || sample.isPending || caps.isPending,
    error: own.error ?? sample.error,
    capsFailed: caps.isError || routings.some((q) => q.isError),
    refetch: () => void Promise.all([own.refetch(), sample.refetch(), caps.refetch()]),
    hasMore: own.hasNextPage || sample.hasNextPage,
    moreBusy: own.isFetchingNextPage || sample.isFetchingNextPage,
    loadMore: () => {
      if (own.hasNextPage) void own.fetchNextPage();
      if (sample.hasNextPage) void sample.fetchNextPage();
    },
  };
}
export type FlowsList = ReturnType<typeof useFlowsList>;
