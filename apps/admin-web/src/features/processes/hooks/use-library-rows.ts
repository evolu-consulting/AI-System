// CR-118/120: hàng của danh sách quy trình = danh sách đã tải → bộ lọc Bật/Tắt → (thư viện) bộ lọc phễu ở URL → sắp xếp/gom theo app.
// Lọc phía client: đổi bộ lọc không gọi thêm API (riêng "đã gán cho tenant X" tải danh sách gán của các def đã gán, cache chung với ô Tenant).
import { useMemo } from "react";
import {
  applyLibFilter,
  groupByApp,
  type LibFilter,
  needsAssignments,
  parseLibFilter,
  searchLibrary,
} from "../lib/library-filter";
import { sortLibraryRows } from "../lib/library-list";
import { rowsForTab } from "../lib/library-view";
import { type LibraryListItem, useAssignmentsOf } from "../library-api";

type In = {
  items: readonly LibraryListItem[] | undefined;
  search: LibFilter & { q?: string | undefined };
  library: boolean;
  templates: boolean;
  enabledFilter: "all" | "on" | "off";
};

export function useLibraryRows(p: In) {
  const { items, search, library, templates, enabledFilter } = p;
  const { app, slot, status, usedBy, q } = search;
  const libFilter = useMemo(
    () => (library ? parseLibFilter({ app, slot, status, usedBy }) : {}),
    [library, app, slot, status, usedBy],
  );
  const needAsg = library && needsAssignments(libFilter);
  const asgIds = useMemo(
    () => (needAsg ? (items ?? []).filter((r) => (r.tenant_count ?? 0) > 0).map((r) => r.id) : []),
    [needAsg, items],
  );
  const asg = useAssignmentsOf(asgIds, needAsg);
  const asgKey = asg.map((a) => a.dataUpdatedAt).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `asgKey` đổi khi dữ liệu gán đổi (mảng `asg` luôn là mảng mới)
  const assigned = useMemo(
    () =>
      new Map(asgIds.map((id, i) => [id, new Set((asg[i]?.data ?? []).map((a) => a.tenant_id))])),
    [asgIds, asgKey],
  );
  const rows = useMemo(() => {
    if (!items) return undefined;
    const list = rowsForTab(items, templates, enabledFilter);
    if (!library) return list;
    const sorted = sortLibraryRows(searchLibrary(applyLibFilter(list, libFilter, assigned), q)); // mặc định ghim đầu, còn lại mới cập nhật trước
    return libFilter.app ? sorted : groupByApp(sorted); // chưa chọn app ⇒ gom theo app (tiêu đề nhóm)
  }, [items, templates, enabledFilter, library, libFilter, assigned, q]);
  return { rows, libFilter, asgLoading: needAsg && asg.some((a) => a.isPending) };
}
