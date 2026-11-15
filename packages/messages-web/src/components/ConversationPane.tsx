// CR-132 · W2 · khối danh sách hội thoại ĐÃ NỐI dữ liệu + hộp «Nhắn tin mới» (toàn màn và khoang hẹp ở W3 dùng cùng khối này).
// CR-169 · lát 6 · thêm bộ lọc công ty (`company` = `?company=` từ nút «Nhắn tin» ở trang đối tác), tìm người tải dần, «Bảng tin <Công ty>».

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
import { messagesHost } from "../host";
import { type CompanyFilter, companyName, parseFilter } from "../lib/company-filter";
import { CompanyFilter as CompanyBar } from "./CompanyFilter";
import { ConversationList } from "./ConversationList";
import { NewConversationDialog } from "./NewConversationDialog";
import { PartnerFeedDialog } from "./PartnerFeedDialog";

type Load = "loading" | "error" | "ready";
const statusOf = (loading: boolean, error: boolean): Load =>
  loading ? "loading" : error ? "error" : "ready";
type Q = { isPending: boolean; isError: boolean };
/** Danh sách cuộc luôn cần; danh bạ chỉ cần ở «<Công ty mình>» (ở nơi khác chỉ khi tìm, lỗi của nó hiện ở mục «Người»). */
const paneStatus = (list: Q, people: Q, directory: boolean): Load =>
  statusOf(
    list.isPending || (directory && people.isPending),
    list.isError || (directory && people.isError),
  );

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
  const [filter, setFilter] = useState<CompanyFilter>(() => parseFilter(company, ownId));
  useEffect(() => setFilter(parseFilter(company, ownId)), [company, ownId]);
  const companies = useCompanies();
  const list = useConversations(filter);
  const [creating, setCreating] = useState(false);
  const [feed, setFeed] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  // «<Công ty mình>» = danh bạ nội bộ (luôn tải); «Tất cả»/công ty khác chỉ tải người khi có chữ tìm.
  const people = usePeople(filter === "own" || dq !== "", dq, filter === "own" ? "own" : filter);
  // Thẻ người (avatar, phòng ban) THEO LÔ cho cả người đã tải lẫn người ở các hội thoại 1-1 nội bộ.
  const ids = useMemo(
    () => [
      ...(filter === "own" ? people.items.map((x) => x.id) : []),
      ...list.items.flatMap((c) => (c.kind === "direct" && c.peer ? [c.peer.id] : [])),
    ],
    [filter, people.items, list.items],
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
        status={paneStatus(list, people, filter === "own")}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        filter={filter}
        company={target}
        onFeed={() => setFeed(true)}
        filterBar={
          <CompanyBar
            value={filter}
            onChange={setFilter}
            ownName={own?.name ?? ""}
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
      {target && (
        <PartnerFeedDialog
          open={feed}
          tenant={target.id}
          company={target.name}
          onClose={() => setFeed(false)}
        />
      )}
    </>
  );
}
