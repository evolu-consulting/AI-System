// CR-132 · W2 · /contracts/messages (`?c=<id>`): toàn màn — trái danh sách 320 px, phải hội thoại; dưới 768 px chỉ một khung một lúc
// (ô chọn → hội thoại, nút ‹ về danh sách). Cả trang là phần của khung ứng dụng (AppShell) nên chiều cao do vùng nội dung quyết định.
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSession } from "~/features/auth/hooks/use-session";
import { cn } from "~/lib/utils";
import { ChatView } from "../components/ChatView";
import { ConversationPane } from "../components/ConversationPane";

export function MessagesPage({ conversationId }: { conversationId: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const myId = useSession((s) => s.me?.id) ?? "";
  const open = (id: string | null) =>
    void navigate({ to: "/contracts/messages", search: id ? { c: id } : {}, replace: false });
  return (
    <div
      data-testid="messages-page"
      className="flex h-[calc(100dvh-8rem)] min-h-[420px] overflow-hidden rounded-xl border border-rule bg-panel max-md:h-[calc(100dvh-10rem)]"
    >
      <aside
        aria-label={t("contracts.messages.title")}
        className={cn(
          "w-80 shrink-0 border-r border-rule-soft max-md:w-full",
          conversationId && "max-md:hidden",
        )}
      >
        <ConversationPane myId={myId} activeId={conversationId} onSelect={open} />
      </aside>
      <div className={cn("min-w-0 flex-1", !conversationId && "max-md:hidden")}>
        {conversationId ? (
          <ChatView
            key={conversationId}
            conversationId={conversationId}
            myId={myId}
            onBack={() => open(null)}
            backClass="md:hidden"
            compact
          />
        ) : (
          <EmptyState
            kind="empty"
            testId="chat-pick"
            title={t("contracts.messages.pickOne")}
            hint={t("contracts.messages.pickOneHint")}
          />
        )}
      </div>
    </div>
  );
}
