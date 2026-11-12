// CR-132 · W2 · khối danh sách hội thoại ĐÃ NỐI dữ liệu + hộp «Nhắn tin mới» (toàn màn và khoang hẹp ở W3 dùng cùng khối này).
import { useState } from "react";
import { useConversations } from "../hooks/use-conversations";
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
  return (
    <>
      <ConversationList
        items={list.items}
        myId={myId}
        activeId={activeId}
        status={list.isPending ? "loading" : list.isError ? "error" : "ready"}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onSelect={onSelect}
        onNew={() => setCreating(true)}
        onMore={() => void list.fetchNextPage()}
        onRetry={() => void list.refetch()}
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
