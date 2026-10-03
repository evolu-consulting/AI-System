// CHAT-AC-01 · `/c/new` tạm (F4): chỉ lời chào có tên user; F7 thay bằng WelcomePage + Composer.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSession } from "~/lib/auth/use-session";

function NewChatPlaceholder() {
  const { t } = useTranslation();
  const name = useSession((s) => s.me?.display_name ?? "");
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center justify-center gap-4 p-6">
      <img
        src="/brand/evoluconsulting-icon.svg"
        alt=""
        width={48}
        height={48}
        className="size-12"
      />
      <h1 className="text-page-title font-bold text-foreground">
        {t("welcome.greeting", { name })}
      </h1>
    </div>
  );
}

export const Route = createFileRoute("/_authed/c/new")({ component: NewChatPlaceholder });
