// CR-151 · hộp chọn người dùng chung: tìm ở máy chủ (gõ có trễ) + tải dần («Xem thêm»), không nạp cả danh sách.
// `fetchPage(q, offset)` trả một trang ≤ 50 người + `next` (offset trang kế, null = hết).
import { Input } from "@ai/web-kit/ui/kit/input";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export type PersonPage = { items: { id: string; name: string }[]; next: number | null };
type Props = {
  id?: string;
  /** Khoá cache riêng của nguồn (để hai hộp khác nguồn không đè nhau). */
  source: string;
  fetchPage: (q: string, offset: number, signal?: AbortSignal) => Promise<PersonPage>;
  value: string;
  /** Tên người đang chọn (giữ lại khi người đó không còn trong trang đang xem). */
  valueName?: string;
  onChange: (id: string, name: string) => void;
  noneLabel: string;
  excludeId?: string;
  disabled?: boolean;
};

export function PersonSearchSelect(p: Props) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQ(raw.trim()), 250);
    return () => clearTimeout(h);
  }, [raw]);
  const list = useInfiniteQuery({
    queryKey: ["person-search", p.source, q],
    queryFn: ({ pageParam, signal }) => p.fetchPage(q, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 30_000,
  });
  const items = (list.data?.pages ?? [])
    .flatMap((x) => x.items)
    .filter((m) => m.id !== p.excludeId);
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="person-search">
      <Input
        id={p.id}
        type="search"
        value={raw}
        disabled={p.disabled}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={t("contracts.paging.search")}
        aria-label={t("contracts.paging.search")}
        className="h-10 w-full"
      />
      <div className="max-h-48 overflow-y-auto rounded-md border border-rule-soft">
        <button
          type="button"
          disabled={p.disabled}
          aria-pressed={p.value === ""}
          onClick={() => p.onChange("", "")}
          className={`block w-full px-3 py-1.5 text-left text-body ${p.value === "" ? "bg-sunk font-semibold" : "hover:bg-sunk"}`}
        >
          {p.noneLabel}
        </button>
        {p.value !== "" && !items.some((m) => m.id === p.value) && p.valueName && (
          <button
            type="button"
            aria-pressed
            className="block w-full bg-sunk px-3 py-1.5 text-left text-body font-semibold"
          >
            {p.valueName}
          </button>
        )}
        {items.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={p.disabled}
            aria-pressed={p.value === m.id}
            onClick={() => p.onChange(m.id, m.name)}
            className={`block w-full px-3 py-1.5 text-left text-body ${p.value === m.id ? "bg-sunk font-semibold" : "hover:bg-sunk"}`}
          >
            {m.name}
          </button>
        ))}
        {list.isPending && (
          <p className="m-0 px-3 py-2 text-label text-dim">{t("contracts.paging.loading")}</p>
        )}
        {list.isError && (
          <p role="alert" className="m-0 px-3 py-2 text-label text-late">
            {t("contracts.paging.error")}
          </p>
        )}
        {list.isSuccess && items.length === 0 && (
          <p className="m-0 px-3 py-2 text-label text-dim">{t("contracts.paging.none")}</p>
        )}
        {list.hasNextPage && (
          <button
            type="button"
            data-testid="person-search-more"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
            className="block w-full px-3 py-1.5 text-left text-label text-act underline"
          >
            {list.isFetchingNextPage ? t("contracts.paging.loading") : t("contracts.paging.more")}
          </button>
        )}
      </div>
    </div>
  );
}
