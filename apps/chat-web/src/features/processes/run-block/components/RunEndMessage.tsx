// CHAT-AC-52 · plan-frontend-thread §3: tin `run_end` — Hoàn tất / Huỷ / Lỗi / Hết hạn + link trang lượt chạy.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ThreadMessageProps } from "../../shared/types";

export type RunEndMessageProps = ThreadMessageProps<"run_end">;

export function RunEndMessage({ part, myId }: RunEndMessageProps) {
  const { t } = useTranslation();
  let line: string;
  if (part.status === "cancelled") {
    const actor = part.actor;
    line = actor
      ? t("process.thread.end.cancelledBy", {
          actor: actor.id === myId ? t("rooms.you") : actor.display_name,
        })
      : t("process.thread.end.cancelled");
  } else if (part.status === "done") {
    line = t("process.thread.end.done");
  } else if (part.status === "failed") {
    line = t("process.thread.end.failed");
  } else {
    line = t("process.thread.end.expired");
  }
  return (
    <article
      aria-label={line}
      className="my-1 flex flex-wrap items-center gap-2 py-1 text-caption text-muted-foreground"
    >
      <span>{line}</span>
      <Link
        to="/runs/$id"
        params={{ id: part.process_run_id }}
        className="text-primary-strong hover:underline"
      >
        {t("process.thread.end.open")}
      </Link>
    </article>
  );
}
