// CR-132 · W2 · khối danh sách hội thoại ĐÃ NỐI dữ liệu + hộp «Nhắn tin mới» (toàn màn và khoang hẹp ở W3 dùng cùng khối này).
// CR-169 · lát 6 · `company` = `?company=` từ nút «Nhắn tin» ở trang đối tác, tìm người tải dần.
// CR-178 · 3 tab «Tất cả · Chưa đọc · Đối tác ▾» (một danh sách gần đây); «Bảng tin <Công ty>» chuyển lên đầu khung chat.

import type { MsgCompany } from "@ai/contracts/pack-contracts";
import { useEffect, useMemo, useState } from "react";
import {
  useCompanies,
  useConversations,
  useCreateConversation,
  usePeople,
} from "../hooks/use-conversations";
import { useDebounced } from "../hooks/use-debounced";
import { usePersonCards } from "../hooks/use-person-cards";
import { useUnreadTotal } from "../hooks/use-unread";
import { messagesHost } from "../host";
import { companyName } from "../lib/company-filter";
import { type ListView, pickTab, viewFilter, viewFromParam, viewUnread } from "../lib/list-view";
import { ConversationList } from "./ConversationList";
import { ListTabs } from "./ListTabs";
import { NewConversationDialog } from "./NewConversationDialog";

type Load = "loading" | "error" | "ready";
const statusOf = (loading: boolean, error: boolean): Load =>
  loading ? "loading" : error ? "error" : "ready";

export function ConversationPane({
  myId,
  activeId,
  onSelect,
  company,
}: {
  myId: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Mở sẵn bộ lọc: `all` | `own` | id công ty (vd `?company=` từ trang đối tác). Đổi giá trị ⇒ lọc lại. */
  company?: string | undefined;
}) {
  const own = messagesHost().useOwnCompany();
  const ownId = own?.id ?? "";
  const [view, setView] = useState<ListView>(() => viewFromParam(company, ownId));
  useEffect(() => setView(viewFromParam(company, ownId)), [company, ownId]);
  const filter = viewFilter(view);
  const companies = useCompanies();
  const list = useConversations(filter, viewUnread(view));
  const unreadTotal = useUnreadTotal();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  // Người chỉ tải khi có chữ tìm (mục «Người» dưới cuộc khớp).
  const people = usePeople(dq !== "", dq, filter);
  // Thẻ người (avatar) THEO LÔ cho người ở các hội thoại 1-1 nội bộ.
  const ids = useMemo(
    () => list.items.flatMap((c) => (c.kind === "direct" && c.peer ? [c.peer.id] : [])),
    [list.items],
  );
  const cards = usePersonCards(ids);
  const create = useCreateConversation();
  const [opening, setOpening] = useState<string | null>(null);
  // Bấm người chưa có cuộc ⇒ mở/tạo (API trả cùng cuộc nếu đã có): khác công ty ⇒ `partner`, cùng công ty ⇒ 1-1 nội bộ.
  const pick = (userId: string, c?: MsgCompany) => {
    if (create.isPending) return;
    setOpening(userId);
    const body =
      c && c.id !== ownId
        ? ({ kind: "partner", tenant_id: c.id, user_id: userId } as const)
        : ({ kind: "direct", user_id: userId } as const);
    create.mutate(body, { onSuccess: (d) => onSelect(d.id), onSettled: () => setOpening(null) });
  };
  const target: MsgCompany | null = useMemo(() => {
    const name = companyName(filter, companies.items);
    return name ? { id: filter, name } : null;
  }, [filter, companies.items]);
  const setTab = (tab: ListView["tab"]) => setView((v) => pickTab(v, tab));
  const peopleStatus =
    people.isPending && people.fetchStatus !== "idle"
      ? "loading"
      : people.isError
        ? "error"
        : "ready";
  return (
    <>
      <ConversationList
        items={list.items}
        people={people.items}
        cards={cards}
        q={q}
        onQ={setQ}
        peopleStatus={peopleStatus}
        peopleHasMore={people.hasNextPage}
        peopleLoadingMore={people.isFetchingNextPage}
        onMorePeople={() => void people.fetchNextPage()}
        openingId={opening}
        onPickPerson={pick}
        myId={myId}
        activeId={activeId}
        status={statusOf(list.isPending, list.isError)}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        tab={view.tab}
        company={target}
        filterBar={
          <ListTabs
            view={view}
            onTab={setTab}
            onCompany={(id) => setView({ tab: "partner", company: id })}
            unreadTotal={unreadTotal}
            companies={companies.items}
            hasMore={companies.hasNextPage}
            loadingMore={companies.isFetchingNextPage}
            onMore={() => void companies.fetchNextPage()}
          />
        }
        onSelect={onSelect}
        onNew={() => setCreating(true)}
        onMore={() => void list.fetchNextPage()}
        onRetry={() => {
          void list.refetch();
          void people.refetch();
        }}
      />
      <NewConversationDialog
        open={creating}
        myId={myId}
        ownId={ownId}
        ownName={own?.name ?? ""}
        onClose={() => setCreating(false)}
        onOpened={(id) => {
          setCreating(false);
          onSelect(id);
        }}
      />
    </>
  );
}
