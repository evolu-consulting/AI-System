// CHAT-AC-57 · BR-25 · plan-frontend §4: phần "nhờ trả lời" của thẻ — người được nhờ (lời nhắn, ngữ cảnh, banner) và người đã nhờ (dòng "↪ Đã nhờ …").
import type { TaskForward } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { FORWARD_CHAIN_MAX } from "../lib/ask-rules";

export function ForwardedToYou({
  forward,
  starter,
  excerpt,
}: {
  forward: TaskForward;
  starter: string | null;
  excerpt: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">{t("process.ask.fromYou", { from: forward.from.display_name })}</p>
      {forward.note && <p className="whitespace-pre-wrap wrap-anywhere">{forward.note}</p>}
      {excerpt && (
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="text-caption font-medium text-muted-foreground">
            {t("process.ask.context")}
          </p>
          <p className="whitespace-pre-wrap wrap-anywhere text-caption">{excerpt}</p>
        </div>
      )}
      <p className="text-caption text-muted-foreground">
        {starter ? t("process.ask.onlyThis", { starter }) : t("process.ask.onlyThisNoName")}
      </p>
    </div>
  );
}

export function ForwardedByYou({ forward, k }: { forward: TaskForward; k: number }) {
  const { t } = useTranslation();
  return (
    <p className="text-caption text-muted-foreground">
      ↪{" "}
      {t("process.ask.forwarded", {
        to: forward.to.display_name,
        k,
        max: FORWARD_CHAIN_MAX,
      })}
    </p>
  );
}
