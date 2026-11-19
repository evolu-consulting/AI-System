// CR-184 · ô chọn người gọn (avatar + họ tên) cùng kiểu «Phụ trách»: nút mở danh sách có ô tìm (ở máy chủ, gõ có trễ) + tải dần («Xem thêm»).
// `fetchPage(q, offset)` như `PersonSearchSelect`. Vùng bấm ≥ 44px ở điện thoại.
import type { PersonCard } from "@ai/contracts/people";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Input } from "@ai/web-kit/ui/kit/input";
import { PersonAvatar } from "@ai/web-kit/ui/kit/person-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@ai/web-kit/ui/kit/popover";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePeopleCards } from "~/features/contract-shared/people";
import type { PersonPage } from "./PersonSearchSelect";

type Props = {
  id?: string;
  testId?: string;
  /** Khoá cache riêng của nguồn. */
  source: string;
  fetchPage: (q: string, offset: number, signal?: AbortSignal) => Promise<PersonPage>;
  value: string;
  valueName?: string | undefined;
  onChange: (id: string, name: string) => void;
  /** Chữ khi chưa chọn ai (cũng là mục «bỏ chọn» đầu danh sách nếu `clearable`). */
  placeholder: string;
  clearable?: boolean;
  excludeId?: string | undefined;
  ariaLabel: string;
};

function Face({ id, name, card }: { id?: string; name: string; card?: PersonCard | undefined }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PersonAvatar name={name} id={id} src={card?.avatar} size={24} interactive={false} />
      <span className="min-w-0">
        <span className="block truncate">{name}</span>
        {card?.job_title && (
          <span className="block truncate text-dim text-xs">{card.job_title}</span>
        )}
      </span>
    </span>
  );
}

export function PersonPick(p: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQ(raw.trim()), 250);
    return () => clearTimeout(h);
  }, [raw]);
  const list = useInfiniteQuery({
    queryKey: ["person-pick", p.source, q],
    queryFn: ({ pageParam, signal }) => p.fetchPage(q, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 30_000,
    enabled: open,
  });
  const items = (list.data?.pages ?? [])
    .flatMap((x) => x.items)
    .filter((m) => m.id !== p.excludeId);
  const cards = usePeopleCards([p.value, ...items.map((m) => m.id)]);
  const pick = (id: string, name: string) => {
    p.onChange(id, name);
    setOpen(false);
  };
  const row = "h-auto min-h-11 w-full justify-start px-3 py-1.5 text-left text-body font-normal";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={p.id}
        data-testid={p.testId}
        aria-label={p.ariaLabel}
        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-rule-soft bg-card px-3 text-body outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10"
      >
        {p.value ? (
          <PersonAvatar
            name={p.valueName ?? ""}
            id={p.value}
            src={cards.get(p.value)?.avatar}
            size={24}
            interactive={false}
          />
        ) : null}
        <span className={p.value ? "" : "text-dim"}>{p.value ? p.valueName : p.placeholder}</span>
        <span aria-hidden="true" className="text-dim text-xs">
          ▾
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <Input
          type="search"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={t("contracts.paging.search")}
          aria-label={t("contracts.paging.search")}
          className="mb-2 h-10 w-full"
        />
        <div className="max-h-60 overflow-y-auto" data-testid="person-pick-list">
          {p.clearable && (
            <Button variant="quiet" className={row} onClick={() => pick("", "")}>
              {p.placeholder}
            </Button>
          )}
          {items.map((m) => (
            <Button
              variant="quiet"
              key={m.id}
              aria-pressed={p.value === m.id}
              className={`${row} ${p.value === m.id ? "bg-sunk font-semibold" : ""}`}
              onClick={() => pick(m.id, m.name)}
            >
              <Face id={m.id} name={m.name} card={cards.get(m.id)} />
            </Button>
          ))}
          {list.hasNextPage && (
            <Button
              variant="quiet"
              className={`${row} text-dim`}
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? t("contracts.paging.loading") : t("contracts.paging.more")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
