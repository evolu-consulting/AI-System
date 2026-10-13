// HUB-FR-131 · G14 · D2/D11: secret `kh_api_key` NỀN TẢNG cho Select "Khoá": gọi `GET /secrets?kind=kh_api_key`,
// lặp `next_cursor` tới hết (≤ 5 trang), lọc client `tenant === null`.
import { useEffect, useMemo } from "react";
import { useSecrets } from "#/features/secrets/hooks/use-secrets";

const MAX_PAGES = 5;

export function useKhKeys() {
  const q = useSecrets("kh_api_key");
  const pages = q.data?.pages.length ?? 0;
  const more = q.hasNextPage && pages < MAX_PAGES;
  const { fetchNextPage, isFetchingNextPage } = q;
  useEffect(() => {
    if (more && !isFetchingNextPage) void fetchNextPage();
  }, [more, isFetchingNextPage, fetchNextPage]);
  const keys = useMemo(
    () => q.items.filter((s) => s.tenant === null).map((s) => ({ id: s.id, name: s.name })),
    [q.items],
  );
  return { keys, loading: q.isPending || more, error: q.isError };
}
