// CR-132 · W2 · danh sách hội thoại (trình bày, không gọi mạng — dùng chung toàn màn và khoang hẹp ở W3): ô lọc, nút «Nhắn tin mới»,
// dòng có avatar/tên/xem trước/giờ, chưa đọc ⇒ in đậm + số. Trạng thái: đang tải · lỗi · rỗng · không khớp.
import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import {
  convTitle,
  filterConversations,
  isUnread,
  previewOf,
  unreadLabel,
} from "../lib/conversations";
import { initialOf, listTime } from "../lib/format";

export type ConversationListProps = {
  items: readonly ConversationSummary[];
  myId: string;
  activeId: string | null;
  status: "loading" | "error" | "ready";
  hasMore: boolean;
  loadingMore: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onMore: () => void;
  onRetry: () => void;
};

function Preview({ c, myId }: { c: ConversationSummary; myId: string }) {
  const { t } = useTranslation();
  const p = previewOf(c, myId);
  const text =
    p.kind === "deleted"
      ? t("contracts.messages.previewDeleted")
      : p.kind === "files"
        ? t("contracts.messages.previewFiles")
        : p.kind === "mine"
          ? t("contracts.messages.previewMine", { text: p.text })
          : p.kind === "other"
            ? p.who
              ? t("contracts.messages.previewOther", { who: p.who, text: p.text })
              : p.text
            : "";
  return <span className="min-w-0 flex-1 truncate">{text}</span>;
}

function Row({
  c,
  myId,
  active,
  onSelect,
}: {
  c: ConversationSummary;
  myId: string;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const unread = isUnread(c);
  const n = unreadLabel(c.unread);
  const title = convTitle(c);
  return (
    <li>
      <button
        type="button"
        data-testid="conv-row"
        data-unread={unread ? "true" : "false"}
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(c.id)}
        className={cn(
          "flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left hover:bg-sunk focus-visible:bg-sunk focus-visible:outline-none",
          active && "bg-act-soft",
        )}
      >
        <span
          aria-hidden
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-act-soft text-[15px] font-semibold text-act"
        >
          {initialOf(title)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[14px]",
                unread ? "font-bold" : "font-medium",
              )}
            >
              {title}
            </span>
            {c.last_message && (
              <time dateTime={c.last_message.at} className="shrink-0 text-micro text-dim">
                {listTime(c.last_message.at)}
              </time>
            )}
          </span>
          <span
            className={cn(
              "flex items-center gap-2 text-label",
              unread ? "font-semibold text-ink" : "text-dim",
            )}
          >
            <Preview c={c} myId={myId} />
            {n && (
              <span
                data-testid="conv-unread"
                role="img"
                aria-label={t("contracts.messages.unread", { n: c.unread })}
                className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-late px-1 text-micro font-semibold text-panel"
              >
                {n}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ConversationList(p: ConversationListProps) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const shown = filterConversations(p.items, q);
  const newBtn = (
    <button type="button" onClick={p.onNew} className="btn btn-primary btn-sm">
      {t("contracts.messages.newChat")}
    </button>
  );
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="conv-list">
      <div className="flex shrink-0 items-center gap-2 px-3 py-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("contracts.messages.search")}
          aria-label={t("contracts.messages.search")}
          className="h-9 min-w-0 flex-1 rounded-lg border border-field bg-panel px-3 text-[13.5px] outline-none focus-visible:border-act-line"
        />
        {newBtn}
      </div>
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
        ) : p.items.length === 0 ? (
          <EmptyState
            kind="empty"
            testId="conv-empty"
            title={t("contracts.messages.emptyList")}
            hint={t("contracts.messages.emptyListHint")}
            action={newBtn}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            kind="search"
            title={t("contracts.messages.noMatch")}
            hint={t("contracts.messages.noMatchHint")}
          />
        ) : (
          <ul aria-label={t("contracts.messages.listLabel")} className="m-0 list-none p-0">
            {shown.map((c) => (
              <Row
                key={c.id}
                c={c}
                myId={p.myId}
                active={c.id === p.activeId}
                onSelect={p.onSelect}
              />
            ))}
          </ul>
        )}
        {p.status === "ready" && p.hasMore && (
          <div className="p-3 text-center">
            <button
              type="button"
              disabled={p.loadingMore}
              onClick={p.onMore}
              className="btn btn-sm"
            >
              {t("contracts.messages.loadMore")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
