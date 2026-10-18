// CHAT-AC-56 · PF3: tab "Nhật ký" (chỉ `full`; ẩn khi `access:"task"`). `history` thời gian ngược (mới → cũ).
import type { HistoryItem, ProcessRunFullView } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { relativeTime } from "~/features/thread/lib/thread-logic";

function lineKey(kind: HistoryItem["kind"]): string {
  return `process.inbox.run.log.${kind}`;
}

export function LogTab({ view }: { view: ProcessRunFullView }) {
  const { t, i18n } = useTranslation();
  const now = Date.now();
  if (view.history.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t("process.inbox.run.log.empty")}</p>;
  }
  const rows = [...view.history].reverse();
  return (
    <ol className="flex flex-col gap-2 p-4">
      {rows.map((h) => (
        <li
          key={`${h.at}-${h.kind}-${h.stage_idx}-${h.task_id ?? ""}`}
          className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2 text-sm last:border-0"
        >
          <span>
            {t(lineKey(h.kind), {
              actor: h.actor?.display_name ?? "—",
              to: h.to?.display_name ?? "—",
              group: h.group?.name ?? "—",
              result: h.result ? t(`process.common.result.${h.result}`) : "",
            })}
          </span>
          <time className="shrink-0 text-caption text-muted-foreground">
            {relativeTime(h.at, now, i18n.language)}
          </time>
        </li>
      ))}
    </ol>
  );
}
