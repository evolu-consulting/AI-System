// ADM-FR-68 · C3 · dữ liệu cho combobox "Tài liệu thư viện": tìm theo tên (debounce ở component), "Tải thêm" theo next_cursor.
// TODO FS-4: route GET /admin/sources/library-documents do backend S3 làm; tới lúc đó lỗi 404 ⇒ `isError` (picker hiện câu lỗi, form vẫn dùng được cho nguồn khác).
import { useMemo, useState } from "react";
import { useLibraryDocs } from "../api";

export type LibraryDocOption = { id: string; name: string; version: string };

export function useLibraryDocPicker(tenantId: string | undefined, enabled: boolean) {
  const [q, setQ] = useState("");
  const query = useLibraryDocs(tenantId, q, enabled);
  const items = useMemo<LibraryDocOption[]>(
    () =>
      (query.data?.pages ?? []).flatMap((p) =>
        p.items.map((d) => ({ id: d.id, name: d.name, version: d.version })),
      ),
    [query.data],
  );
  return {
    items,
    setQuery: setQ,
    isLoading: query.isPending && enabled,
    isError: query.isError,
    hasMore: !!query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  };
}
export type LibraryDocPickerData = ReturnType<typeof useLibraryDocPicker>;
