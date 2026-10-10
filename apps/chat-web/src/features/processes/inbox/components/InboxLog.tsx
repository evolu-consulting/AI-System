// CHAT-AC-55 · PF3: `log` thông báo quy trình (cũ→mới, chia nhóm ngày). Chạm đỉnh ⇒ nạp trang cũ; cuộn tới đáy ⇒ đánh
// dấu đã đọc (debounce 500 ms). Tự mở 3 thẻ mới nhất có việc còn mở.
import type { ProcessNotice } from "@ai/contracts/chat";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { useInView } from "../../shared/hooks/use-in-view";
import { useInbox, useMarkInboxRead } from "../api";
import { noticeHasTask } from "../lib/notice";
import { NoticeCard } from "./NoticeCard";

const AUTO_EXPAND = 3;
const READ_DEBOUNCE_MS = 500;

function dayLabel(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(iso),
  );
}

export function InboxLog() {
  const { t, i18n } = useTranslation();
  const q = useInbox();
  const markRead = useMarkInboxRead();
  const top = useInView<HTMLDivElement>();
  const bottom = useInView<HTMLDivElement>();

  // Server trả mới→cũ; hiển thị cũ→mới.
  const newestFirst: ProcessNotice[] = useMemo(
    () => q.data?.pages.flatMap((p) => p.items) ?? [],
    [q.data],
  );
  const ordered = useMemo(() => [...newestFirst].reverse(), [newestFirst]);
  const unread = q.data?.pages[0]?.unread ?? 0;
  const newestId = newestFirst[0]?.id;

  // Nạp trang cũ khi chạm đỉnh.
  useEffect(() => {
    if (top.inView && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [top.inView, q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage]);

  // Cuộn tới đáy + còn chưa đọc ⇒ đánh dấu đã đọc (debounce).
  useEffect(() => {
    if (!bottom.inView || unread === 0 || !newestId || markRead.isPending) return;
    const id = setTimeout(() => markRead.mutate(newestId), READ_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [bottom.inView, unread, newestId, markRead.mutate, markRead.isPending]);

  // 3 notice mới nhất có việc còn mở ⇒ tự mở.
  const autoIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of newestFirst) {
      if (ids.size >= AUTO_EXPAND) break;
      if (noticeHasTask(n)) ids.add(n.id);
    }
    return ids;
  }, [newestFirst]);

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy="true">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {t("process.common.error.load")}{" "}
        <button type="button" className="underline" onClick={() => void q.refetch()}>
          {t("process.common.error.retry")}
        </button>
      </p>
    );
  }
  if (ordered.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">{t("process.inbox.dm.empty")}</p>
    );
  }

  let lastDay = "";
  return (
    <div
      role="log"
      aria-label={t("process.inbox.dm.log")}
      aria-live="polite"
      className="flex flex-col gap-3 p-4"
    >
      <div ref={top.ref} aria-hidden className="h-px" />
      {q.isFetchingNextPage && <Skeleton className="h-16 w-full" />}
      {ordered.map((n) => {
        const day = dayLabel(n.created_at, i18n.language);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <div key={n.id} className="flex flex-col gap-3">
            {showDay && <p className="text-center text-caption text-muted-foreground">{day}</p>}
            <NoticeCard notice={n} autoExpand={autoIds.has(n.id)} />
          </div>
        );
      })}
      <div ref={bottom.ref} aria-hidden className="h-px" />
    </div>
  );
}
