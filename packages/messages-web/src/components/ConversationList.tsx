// CR-132 · W2 · danh sách hội thoại (trình bày, không gọi mạng — dùng chung toàn màn và khoang hẹp ở W3): ô tìm, «Nhắn tin mới», «Tất cả / Chưa đọc».
// CR-190 · thân = danh bạ nhóm (từng công ty đối tác A→Z, «Nhóm chat», «Nội bộ») hoặc cuộc chưa đọc; khi tìm (≥ 2 ký tự) có thêm tab «Tin nhắn».
// Cột tự cuộn trong khung (trang toàn màn không cuộn). Trạng thái: đang tải · lỗi · rỗng · không khớp.

import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { canSearch } from "../hooks/use-find";
import { IconChevronLeft } from "../icons";
import { Skeleton } from "../ui";
import { ListFilter } from "./ListFilter";
import type { ConversationListProps } from "./list-types";

type FindTab = "messages" | "people";

/** CR-178 · M3 · chế độ tìm (≥ 2 ký tự): tab «Tin nhắn» (kết quả tìm tin) và «Người» (danh bạ lọc theo chữ tìm). */
function SearchMode({ p }: { p: ConversationListProps }) {
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
      {tab === "messages" ? p.messageSearch : p.main}
    </>
  );
}

function Body({ p, finding }: { p: ConversationListProps; finding: boolean }) {
  const { t } = useTranslation();
  if (p.status === "loading")
    return (
      <div className="space-y-3 p-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  if (p.status === "error")
    return (
      <EmptyState
        kind="error"
        title={t("contracts.messages.loadError")}
        action={
          <button type="button" onClick={p.onRetry} className="btn btn-sm">
            {t("contracts.messages.retry")}
          </button>
        }
      />
    );
  return (
    <div
      data-testid="conv-body"
      aria-busy={p.fading}
      className={p.fading ? "pointer-events-none opacity-50 transition-opacity" : undefined}
    >
      {finding ? <SearchMode p={p} /> : p.main}
    </div>
  );
}

export function ConversationList(p: ConversationListProps) {
  const { t } = useTranslation();
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
        <button type="button" onClick={p.onNew} className="btn btn-primary btn-sm">
          {t("contracts.messages.newChat")}
        </button>
      </div>
      {!finding && <ListFilter tab={p.tab} onTab={p.onTab} unreadTotal={p.unreadTotal} />}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Body p={p} finding={finding} />
      </div>
    </div>
  );
}
