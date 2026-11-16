// CR-132 · W2 · danh sách hội thoại (trình bày, không gọi mạng — dùng chung toàn màn và khoang hẹp ở W3): ô tìm, «Nhắn tin mới», 3 tab lọc.
// CR-178 · MỘT kiểu danh sách: cuộc gần đây (mới nhất trước, tải dần) + khi tìm có mục «Người». Danh bạ theo phòng ban và nút «Bảng tin» đã chuyển
// sang «Nhắn tin mới» và đầu khung chat. Trạng thái: đang tải · lỗi · rỗng · không khớp.

import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { canSearch } from "../hooks/use-find";
import { IconChevronLeft } from "../icons";
import { filterConversations } from "../lib/conversations";
import { Skeleton } from "../ui";
import { ConversationRow } from "./ConversationRow";
import { LoadSentinel } from "./LoadSentinel";
import type { ConversationListProps } from "./list-types";
import { PeopleSearch } from "./PeopleSearch";

function RecentRows({
  p,
  rows,
}: {
  p: ConversationListProps;
  rows: readonly ConversationSummary[];
}) {
  return (
    <ul className="m-0 list-none p-0" data-testid="recent-list">
      {rows.map((c) => (
        <ConversationRow
          key={c.id}
          c={c}
          myId={p.myId}
          card={c.kind === "direct" ? p.cards.get(c.peer?.id ?? "") : undefined}
          active={c.id === p.activeId}
          onOpen={() => p.onSelect(c.id)}
        />
      ))}
    </ul>
  );
}

function emptyTitle(
  p: ConversationListProps,
  t: (key: string, o?: Record<string, unknown>) => string,
): string {
  if (p.tab === "unread") return t("contracts.messages.emptyUnread");
  if (p.tab === "partner" && p.company)
    return t("contracts.messages.emptyCompany", { company: p.company.name });
  return t("contracts.messages.emptyList");
}

/** «Tất cả» / công ty khác: cuộc gần đây; có chữ tìm ⇒ cuộc khớp + mục «Người» (chưa có cuộc). */
function RecentView({ p, newBtn }: { p: ConversationListProps; newBtn: ReactNode }) {
  const { t } = useTranslation();
  const searching = p.q.trim() !== "";
  const rows = filterConversations(p.items, p.q);
  const have = new Set(p.items.flatMap((c) => (c.peer ? [c.peer.id] : [])));
  const fresh = p.people.filter((x) => !have.has(x.id) && x.id !== p.myId);
  if (!searching && rows.length === 0)
    return (
      <EmptyState
        kind="empty"
        testId="conv-empty"
        title={emptyTitle(p, t)}
        hint={p.tab === "all" ? t("contracts.messages.emptyListHint") : undefined}
        action={p.tab === "unread" ? undefined : newBtn}
      />
    );
  const nothing =
    searching && rows.length === 0 && fresh.length === 0 && p.peopleStatus === "ready";
  return (
    <>
      {rows.length > 0 && <RecentRows p={p} rows={rows} />}
      {!searching && p.hasMore && <LoadSentinel loading={p.loadingMore} onMore={p.onMore} />}
      {searching && (
        <PeopleSearch
          people={fresh}
          status={p.peopleStatus}
          hasMore={p.peopleHasMore}
          loadingMore={p.peopleLoadingMore}
          openingId={p.openingId}
          onPick={(x) => p.onPickPerson(x.id, x.company)}
          onMore={p.onMorePeople}
          onRetry={p.onRetry}
        />
      )}
      {nothing && (
        <EmptyState
          kind="search"
          title={t("contracts.messages.noMatch")}
          hint={t("contracts.messages.noMatchHint")}
        />
      )}
    </>
  );
}

type FindTab = "messages" | "people";

/** CR-178 · M3 · chế độ tìm (≥ 2 ký tự): tab «Tin nhắn» (kết quả tìm tin) và «Người» (cuộc + người như cũ). */
function SearchMode({ p, newBtn }: { p: ConversationListProps; newBtn: ReactNode }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<FindTab>("messages");
  const tabBtn = (k: FindTab, label: string) => (
    <button
      key={k}
      type="button"
      role="tab"
      aria-selected={tab === k}
      data-testid={`find-tab-${k}`}
      onClick={() => setTab(k)}
      className={`h-8 flex-1 border-b-2 text-[13px] font-semibold ${tab === k ? "border-act text-ink" : "border-transparent text-dim"}`}
    >
      {label}
    </button>
  );
  return (
    <>
      <div role="tablist" className="flex shrink-0 border-b border-rule-soft px-3">
        {tabBtn("messages", t("contracts.messages.find.tabMessages"))}
        {tabBtn("people", t("contracts.messages.find.tabPeople"))}
      </div>
      {tab === "messages" ? p.messageSearch : <RecentView p={p} newBtn={newBtn} />}
    </>
  );
}

export function ConversationList(p: ConversationListProps) {
  const { t } = useTranslation();
  const newBtn = (
    <button type="button" onClick={p.onNew} className="btn btn-primary btn-sm">
      {t("contracts.messages.newChat")}
    </button>
  );
  const finding = p.messageSearch != null && canSearch(p.q);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="conv-list">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        {finding && (
          <button
            type="button"
            onClick={() => p.onQ("")}
            aria-label={t("contracts.messages.find.close")}
            title={t("contracts.messages.find.close")}
            data-testid="find-exit"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-dim hover:bg-sunk hover:text-ink max-sm:h-11 max-sm:w-11"
          >
            <IconChevronLeft width={18} height={18} />
          </button>
        )}
        <input
          type="search"
          value={p.q}
          onChange={(e) => p.onQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && p.q !== "" && p.onQ("")}
          placeholder={t("contracts.messages.search")}
          aria-label={t("contracts.messages.search")}
          className="h-9 min-w-0 flex-1 rounded-lg border border-field bg-panel px-3 text-[13.5px] outline-none focus-visible:border-act-line max-sm:h-11"
        />
        {newBtn}
      </div>
      {!finding && p.filterBar}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {p.status === "loading" ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : p.status === "error" ? (
          <EmptyState
            kind="error"
            title={t("contracts.messages.loadError")}
            action={
              <button type="button" onClick={p.onRetry} className="btn btn-sm">
                {t("contracts.messages.retry")}
              </button>
            }
          />
        ) : finding ? (
          <SearchMode p={p} newBtn={newBtn} />
        ) : (
          <RecentView p={p} newBtn={newBtn} />
        )}
      </div>
    </div>
  );
}
