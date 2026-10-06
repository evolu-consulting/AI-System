// CHAT-AC-05, CHAT-AC-10, CHAT-AC-18 · trang chào `/c/new`: lời chào + thẻ gợi ý + Composer; tin đầu: E6 tạo hội thoại → E12 gửi → `/c/:id`.
import { deriveTitle } from "@ai/contracts/chat";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Composer,
  type ComposerHandle,
  type SubmitResult,
} from "~/features/composer/components/Composer";
import { useDraftKey } from "~/features/composer/hooks/use-draft";
import { useCreateConversation } from "~/features/conversations/hooks/use-conversations";
import { useRunByKey } from "~/features/run/hooks/use-run-stream";
import { useSend } from "~/features/run/hooks/use-send";
import { useSession } from "~/lib/auth/use-session";
import { SuggestionCards } from "../components/SuggestionCards";

export function WelcomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const name = useSession((s) => s.me?.display_name ?? "");
  const newDraftKey = useDraftKey(null, null);
  const send = useSend();
  const create = useCreateConversation();
  const composer = useRef<ComposerHandle>(null);
  // E6 đã tạo mà E12 lỗi: thử lại dùng lại hội thoại này, không tạo thêm.
  const pendingConv = useRef<string | null>(null);
  const [runKey, setRunKey] = useState<string | null>(null);
  const run = useRunByKey(runKey);

  const submit = useCallback(
    async (content: string): Promise<SubmitResult> => {
      try {
        pendingConv.current ??= (await create.mutateAsync(deriveTitle(content))).id;
      } catch {
        return false;
      }
      const convId = pendingConv.current;
      const out = await send.sendMain(convId, content);
      if (!out.ok) return out;
      setRunKey(out.key);
      pendingConv.current = null;
      void router.navigate({ to: "/c/$id", params: { id: convId }, replace: true });
      return out;
    },
    [create, send, router],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center justify-center gap-6 p-6">
        <img
          src="/brand/evoluconsulting-icon.svg"
          alt=""
          width={48}
          height={48}
          className="size-12"
        />
        <h1 className="text-center text-page-title font-bold text-foreground">
          {t("welcome.greeting", { name })}
        </h1>
        <p className="text-center text-sm text-muted-foreground">{t("welcome.hint")}</p>
        <SuggestionCards onPick={(p) => composer.current?.fill(p)} />
        <p className="text-xs text-muted-foreground">{t("welcome.cardsHint")}</p>
        <Composer
          ref={composer}
          variant="main"
          draftKey={newDraftKey}
          autoFocus
          quotaOver={run?.quota?.state === "over"}
          onSubmit={submit}
        />
      </div>
    </div>
  );
}
