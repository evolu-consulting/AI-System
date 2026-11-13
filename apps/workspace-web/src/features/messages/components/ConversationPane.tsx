// CR-132 · W2 · khối danh sách hội thoại ĐÃ NỐI dữ liệu + hộp «Nhắn tin mới» (toàn màn và khoang hẹp ở W3 dùng cùng khối này).
import { useState } from "react";
import { useConversations, useCreateConversation, usePeople } from "../hooks/use-conversations";
import { ConversationList } from "./ConversationList";
import { NewConversationDialog } from "./NewConversationDialog";

export function ConversationPane({
  myId,
  activeId,
  onSelect,
}: {
  myId: string;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const list = useConversations();
  const [creating, setCreating] = useState(false);
  const people = usePeople(true);
  const create = useCreateConversation();
  const [opening, setOpening] = useState<string | null>(null);
  // Bấm thành viên chưa có 1-1 ⇒ mở/tạo (API trả cùng hội thoại nếu đã có), rồi mở khung chat.
  const pick = (userId: string) => {
    if (create.isPending) return;
    setOpening(userId);
    create.mutate(
      { kind: "direct", user_id: userId },
      { onSuccess: (d) => onSelect(d.id), onSettled: () => setOpening(null) },
    );
  };
  return (
    <>
      <ConversationList
        items={list.items}
        people={people.data?.items ?? []}
        openingId={opening}
        onPickPerson={pick}
        myId={myId}
        activeId={activeId}
        status={
          list.isPending || people.isPending
            ? "loading"
            : list.isError || people.isError
              ? "error"
              : "ready"
        }
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
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
        onClose={() => setCreating(false)}
        onOpened={(id) => {
          setCreating(false);
          onSelect(id);
        }}
      />
    </>
  );
}
