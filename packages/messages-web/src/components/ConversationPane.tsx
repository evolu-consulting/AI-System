// CR-132 · W2 · khối danh sách hội thoại ĐÃ NỐI dữ liệu + hộp «Nhắn tin mới» (toàn màn và khoang hẹp ở W3 dùng cùng khối này).
// CR-190 · «Tất cả» = danh bạ nhóm từ máy chủ (`useDirectory`: từng công ty đối tác A→Z, «Nhóm chat», «Nội bộ»); «Chưa đọc» = cuộc còn chưa đọc.
// `company` = `?company=` từ nút «Nhắn tin» ở trang đối tác ⇒ mở sẵn nhóm công ty đó. Bấm người chưa từng nhắn ⇒ mở cuộc rồi khung chat hiện màn chào.

import type { ConversationSummary, MsgCompany } from "@ai/contracts/pack-contracts";
import { useEffect, useMemo, useState } from "react";
import { requestJump } from "../hooks/jump-request";
import { useConversations, useCreateConversation } from "../hooks/use-conversations";
import { useDebounced } from "../hooks/use-debounced";
import { useDirectory, useLoadMoreGroup, useRowActions } from "../hooks/use-directory";
import { usePersonCards } from "../hooks/use-person-cards";
import { useUnreadTotal } from "../hooks/use-unread";
import { messagesHost } from "../host";
import { readOpen, setOpen, writeOpen } from "../lib/collapse";
import { bodyStatus, type DirData } from "../lib/directory";
import { ConversationList } from "./ConversationList";
import { DirectoryView } from "./DirectoryView";
import type { ListTab } from "./ListFilter";
import { NewConversationDialog } from "./NewConversationDialog";
import { SearchHits } from "./SearchHits";
import { UnreadList } from "./UnreadList";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mở/thu nhóm nhớ trên máy; `company` (`?company=`) ⇒ mở sẵn nhóm công ty đối tác đó. */
function useOpenGroups(company: string | undefined, ownId: string) {
  const [open, setOpenMap] = useState(() => readOpen());
  useEffect(() => {
    if (!company || !UUID.test(company) || company.toLowerCase() === ownId.toLowerCase()) return;
    setOpenMap((m) => setOpen(m, `partner:${company.toLowerCase()}`, true));
  }, [company, ownId]);
  const toggle = (key: string, now: boolean) =>
    setOpenMap((m) => {
      const next = setOpen(m, key, now);
      writeOpen(next);
      return next;
    });
  return [open, toggle] as const;
}

/** Id người cần thẻ (avatar) THEO LÔ: đồng nghiệp nội bộ ở danh bạ và người ở cuộc 1-1 của tab «Chưa đọc». */
function useCardIds(dir: DirData | undefined, unread: readonly ConversationSummary[]): string[] {
  return useMemo(() => {
    const fromDir =
      dir?.groups.flatMap((g) =>
        g.kind === "internal" ? g.items.flatMap((r) => (r.person ? [r.person.id] : [])) : [],
      ) ?? [];
    const fromUnread = unread.flatMap((c) => (c.kind === "direct" && c.peer ? [c.peer.id] : []));
    return [...fromDir, ...fromUnread];
  }, [dir, unread]);
}

export function ConversationPane({
  myId,
  activeId,
  onSelect,
  company,
}: {
  myId: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Mở sẵn nhóm công ty đối tác này (vd `?company=` từ trang đối tác). */
  company?: string | undefined;
}) {
  const own = messagesHost().useOwnCompany();
  const ownId = own?.id ?? "";
  const [tab, setTab] = useState<ListTab>("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const [open, toggle] = useOpenGroups(company, ownId);
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const dir = useDirectory(dq);
  const more = useLoadMoreGroup(dq);
  const unreadList = useConversations("all", true, tab === "unread");
  const unreadTotal = useUnreadTotal();
  const actions = useRowActions();
  const create = useCreateConversation();

  const cards = usePersonCards(useCardIds(dir.data, unreadList.items));

  // Bấm người chưa có cuộc ⇒ mở/tạo (API trả cùng cuộc nếu đã có): khác công ty ⇒ `partner`, cùng công ty ⇒ 1-1 nội bộ.
  const pick = (userId: string, c: MsgCompany) => {
    if (create.isPending) return;
    setOpening(userId);
    const body =
      c.id !== ownId
        ? ({ kind: "partner", tenant_id: c.id, user_id: userId } as const)
        : ({ kind: "direct", user_id: userId } as const);
    create.mutate(body, { onSuccess: (d) => onSelect(d.id), onSettled: () => setOpening(null) });
  };
  const menu = {
    onPin: actions.pin,
    onMarkUnread: actions.markUnread,
    onMarkRead: (c: {
      id: string;
      last_message: { seq: number } | null;
      marked_unread?: boolean | undefined;
    }) => actions.markRead(c.id, c.last_message?.seq ?? null, c.marked_unread ?? false),
  };

  const wantUnread = tab === "unread";
  const dirData = dir.data;
  // Chưa có dữ liệu cho màn đang xem: có dữ liệu cũ ⇒ giữ, làm mờ; chưa có gì ⇒ khung chờ.
  const waiting = wantUnread ? unreadList.isPending : dir.isPlaceholderData;
  const status = bodyStatus(dirData !== undefined, dir.isError, wantUnread && unreadList.isError);
  const main =
    wantUnread && !unreadList.isPending ? (
      <UnreadList
        items={unreadList.items}
        myId={myId}
        activeId={activeId}
        cards={cards}
        hasMore={unreadList.hasNextPage}
        loadingMore={unreadList.isFetchingNextPage}
        onMore={() => void unreadList.fetchNextPage()}
        onSelect={onSelect}
        menu={menu}
      />
    ) : dirData ? (
      <DirectoryView
        data={dirData}
        searching={dq !== ""}
        open={open}
        onToggle={toggle}
        myId={myId}
        activeId={activeId}
        cards={cards}
        loadingGroup={more.isPending ? (more.variables?.group ?? null) : null}
        onMore={(group, cursor) => more.mutate({ group, cursor })}
        openingId={opening}
        onSelect={onSelect}
        onPickPerson={pick}
        menu={menu}
      />
    ) : null;
  return (
    <>
      <ConversationList
        q={q}
        onQ={setQ}
        tab={tab}
        onTab={setTab}
        unreadTotal={unreadTotal}
        status={status}
        fading={waiting}
        main={main}
        messageSearch={
          <SearchHits
            q={dq}
            onOpen={(h) => {
              requestJump(h.conversation_id, h.seq);
              onSelect(h.conversation_id);
            }}
          />
        }
        onNew={() => setCreating(true)}
        onRetry={() => {
          void dir.refetch();
          void unreadList.refetch();
        }}
      />
      <NewConversationDialog
        open={creating}
        myId={myId}
        onClose={() => setCreating(false)}
        onOpened={(id) => {
          setCreating(false);
          onSelect(id);
        }}
      />
    </>
  );
}
