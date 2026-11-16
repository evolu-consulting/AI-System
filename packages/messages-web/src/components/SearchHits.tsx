// CR-178 · M3 · kết quả «Tìm tin nhắn» (mọi cuộc): tên cuộc, người gửi, thời gian, đoạn trích tô sáng chỗ khớp; mới nhất trước, tải dần.
import type { MsgSearchHit } from "@ai/contracts/pack-contracts";
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { useTranslation } from "react-i18next";
import { canSearch, useMessageSearch } from "../hooks/use-find";
import { highlightParts } from "../lib/find";
import { listTime } from "../lib/format";
import { Skeleton } from "../ui";
import { LoadSentinel } from "./LoadSentinel";

/** Đoạn trích với chỗ khớp trong `<mark>`. */
export function Snippet({ hit }: { hit: Pick<MsgSearchHit, "snippet" | "match"> }) {
  const p = highlightParts(hit.snippet, hit.match);
  return (
    <span className="line-clamp-2 text-[12.5px] text-dim [overflow-wrap:anywhere]">
      {p.before}
      {p.hit && <mark className="rounded-sm bg-warning-bg px-0.5 text-ink">{p.hit}</mark>}
      {p.after}
    </span>
  );
}

export function SearchHits({ q, onOpen }: { q: string; onOpen: (hit: MsgSearchHit) => void }) {
  const { t } = useTranslation();
  const s = useMessageSearch(q, null);
  const term = q.trim();
  if (!canSearch(term)) return null;
  if (s.isPending)
    return (
      <div className="space-y-3 p-4" data-testid="find-loading">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  if (s.isError)
    return (
      <EmptyState
        kind="error"
        title={t("contracts.messages.loadError")}
        action={
          <button type="button" className="btn btn-sm" onClick={() => void s.refetch()}>
            {t("contracts.messages.retry")}
          </button>
        }
      />
    );
  if (s.items.length === 0)
    return (
      <EmptyState
        kind="search"
        testId="find-empty"
        title={t("contracts.messages.find.none", { q: term })}
        hint={t("contracts.messages.find.noneHint")}
      />
    );
  return (
    <>
      <ul className="m-0 list-none p-0" data-testid="find-hits">
        {s.items.map((h) => (
          <li key={`${h.conversation_id}:${h.seq}`}>
            <button
              type="button"
              data-testid="find-hit"
              onClick={() => onOpen(h)}
              className="flex w-full min-w-0 flex-col gap-0.5 border-b border-rule-soft px-3 py-2.5 text-left hover:bg-sunk focus-visible:bg-sunk"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                  {h.title}
                </span>
                <time dateTime={h.at} className="shrink-0 text-micro text-dim">
                  {listTime(h.at)}
                </time>
              </span>
              <span className="truncate text-micro text-dim">{h.sender_name}</span>
              <Snippet hit={h} />
            </button>
          </li>
        ))}
      </ul>
      {s.hasNextPage && (
        <LoadSentinel loading={s.isFetchingNextPage} onMore={() => void s.fetchNextPage()} />
      )}
    </>
  );
}
