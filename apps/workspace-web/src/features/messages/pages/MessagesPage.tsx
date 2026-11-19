// CR-132 · W2 · /contracts/messages (`?c=<id>`): toàn màn — trái danh sách 320 px, phải hội thoại; dưới 768 px chỉ một khung một lúc
// (ô chọn → hội thoại, nút ‹ về danh sách). CR-187: trang toàn màn (`FULLSCREEN_PATHS`) — Shell giữ chiều cao, trang đứng yên, chỉ khung con cuộn.

import { ChatPick } from "@ai/messages-web/components/ChatPick";
import { ChatView } from "@ai/messages-web/components/ChatView";
import { ConversationPane } from "@ai/messages-web/components/ConversationPane";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSession } from "~/features/auth/hooks/use-session";
import { cn } from "~/lib/utils";

export function MessagesPage({
  conversationId,
  company,
}: {
  conversationId: string | null;
  /** `?company=`: mở sẵn bộ lọc công ty (CR-169). */
  company?: string | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const myId = useSession((s) => s.me?.id) ?? "";
  const open = (id: string | null) =>
    void navigate({ to: "/contracts/messages", search: id ? { c: id } : {}, replace: false });
  return (
    <div
      data-testid="messages-page"
      className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-rule bg-panel"
    >
      <aside
        aria-label={t("contracts.messages.title")}
        className={cn(
          "w-80 shrink-0 overflow-hidden border-r border-rule-soft max-md:w-full",
          conversationId && "max-md:hidden",
        )}
      >
        <ConversationPane myId={myId} activeId={conversationId} onSelect={open} company={company} />
      </aside>
      <div className={cn("flex min-w-0 flex-1 flex-col", !conversationId && "max-md:hidden")}>
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
          <ChatPick />
        )}
      </div>
    </div>
  );
}
