// CR-169 · /messages (`?c=<id hội thoại>&company=<id công ty>`): cùng màn «Tin nhắn» với Sổ Hợp Tác (gói `@ai/messages-web`).
// Trái danh sách 320 px, phải hội thoại; dưới 768 px chỉ một khung một lúc. Không có quyền Sổ Hợp Tác ⇒ về Hỏi AI.
import { ChatView } from "@ai/messages-web/components/ChatView";
import { ConversationPane } from "@ai/messages-web/components/ConversationPane";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ensureMessagesLocale } from "~/app/i18n";
import { useSession } from "~/lib/auth/use-session";
import { cn } from "~/lib/utils";
import { ConfirmHost } from "../components/ConfirmHost";
import { useMessagesAccess } from "../hooks/use-messages-access";

export function MessagesPage({
  conversationId,
  company,
}: {
  conversationId: string | null;
  company?: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { allowed, loading } = useMessagesAccess();
  const myId = useSession((s) => s.me?.id) ?? "";
  const [ready, setReady] = useState(false);
  const lng = i18n.language;
  useEffect(() => {
    let dead = false;
    setReady(false);
    const done = () => !dead && setReady(true);
    ensureMessagesLocale(lng).then(done, done);
    return () => {
      dead = true;
    };
  }, [lng]);
  if (loading || !ready) return <div className="flex-1" aria-busy="true" />;
  if (!allowed) return <Navigate to="/c/new" replace />;
  const open = (id: string | null) =>
    void navigate({ to: "/messages", search: id ? { c: id } : {}, replace: false });
  return (
    <div className="flex min-h-0 flex-1 p-3 max-md:p-0" data-testid="messages-page">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card max-md:rounded-none max-md:border-0">
        <aside
          aria-label={t("contracts.messages.title")}
          className={cn(
            "w-80 shrink-0 border-r border-border max-md:w-full",
            conversationId && "max-md:hidden",
          )}
        >
          <ConversationPane
            myId={myId}
            activeId={conversationId}
            onSelect={open}
            company={company}
          />
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
            <div
              data-testid="chat-pick"
              className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center"
            >
              <p className="text-sm font-semibold">{t("contracts.messages.pickOne")}</p>
              <p className="text-sm text-muted-foreground">{t("contracts.messages.pickOneHint")}</p>
            </div>
          )}
        </div>
      </div>
      <ConfirmHost />
    </div>
  );
}
