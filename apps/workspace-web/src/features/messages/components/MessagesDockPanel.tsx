// CR-132 · W3 · ruột tab «Tin nhắn» của khoang trợ lý (hẹp): danh sách ⇄ hội thoại (nút ‹ về danh sách, không đóng khoang).
// Hội thoại đang mở do khoang giữ (`convId`) nên đóng/mở khoang vẫn ở đúng chỗ. Nạp lazy (chunk riêng, chỉ khi mở tab).
import { useSession } from "~/features/auth/hooks/use-session";
import { ChatView } from "./ChatView";
import { ConversationPane } from "./ConversationPane";

export default function MessagesDockPanel({
  convId,
  onOpen,
}: {
  convId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const myId = useSession((s) => s.me?.id) ?? "";
  return (
    <div className="h-full min-h-0" data-testid="dock-messages">
      {convId ? (
        <ChatView
          key={convId}
          conversationId={convId}
          myId={myId}
          compact
          onBack={() => onOpen(null)}
        />
      ) : (
        <ConversationPane myId={myId} activeId={null} onSelect={onOpen} />
      )}
    </div>
  );
}
