// CR-190 · tab «Chưa đọc»: các cuộc còn tin chưa đọc (kể cả cuộc chỉ có cờ «đánh dấu chưa đọc»), mới nhất trước, tải dần. Cùng hình dòng với danh bạ.
import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import type { PersonCard } from "@ai/contracts/people";
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { useTranslation } from "react-i18next";
import { convToRow } from "../lib/dir-rows";
import { ConversationRow } from "./ConversationRow";
import { LoadSentinel } from "./LoadSentinel";
import type { RowMenuHandlers } from "./RowMenu";

export function UnreadList(p: {
  items: readonly ConversationSummary[];
  myId: string;
  activeId: string | null;
  cards: ReadonlyMap<string, PersonCard>;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  onSelect: (id: string) => void;
  menu: RowMenuHandlers;
}) {
  const { t } = useTranslation();
  if (p.items.length === 0)
    return (
      <EmptyState kind="empty" testId="conv-empty" title={t("contracts.messages.emptyUnread")} />
    );
  return (
    <>
      <ul className="m-0 list-none p-0" data-testid="recent-list">
        {p.items.map((c) => (
          <ConversationRow
            key={c.id}
            row={convToRow(c)}
            showCompany
            myId={p.myId}
            card={c.kind === "direct" ? p.cards.get(c.peer?.id ?? "") : undefined}
            active={c.id === p.activeId}
            menu={p.menu}
            onOpen={() => p.onSelect(c.id)}
          />
        ))}
      </ul>
      {p.hasMore && <LoadSentinel loading={p.loadingMore} onMore={p.onMore} />}
    </>
  );
}
