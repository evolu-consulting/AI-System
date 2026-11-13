// CR-132 · W2 · một dòng danh sách: avatar/tên/xem trước/giờ, chưa đọc ⇒ in đậm + số. CR-132b: dòng «Thành viên» chưa có 1-1 (`c` null) bấm là mở/tạo.
import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { convTitle, isUnread, previewOf, unreadLabel } from "../lib/conversations";
import { initialOf, listTime } from "../lib/format";

function Preview({ c, myId }: { c: ConversationSummary; myId: string }) {
  const { t } = useTranslation();
  const p = previewOf(c, myId);
  const text =
    p.kind === "deleted"
      ? t("contracts.messages.previewDeleted")
      : p.kind === "files"
        ? t("contracts.messages.previewFiles")
        : p.kind === "mine"
          ? t("contracts.messages.previewMine", { text: p.text })
          : p.kind === "other"
            ? p.who
              ? t("contracts.messages.previewOther", { who: p.who, text: p.text })
              : p.text
            : "";
  return <span className="min-w-0 flex-1 truncate">{text}</span>;
}

export function ConversationRow({
  c,
  name,
  myId,
  active,
  onOpen,
  busy = false,
}: {
  c: ConversationSummary | null;
  /** Tên hiện khi chưa có hội thoại (thành viên chưa nhắn). */
  name?: string;
  myId: string;
  active: boolean;
  onOpen: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const unread = c ? isUnread(c) : false;
  const n = c ? unreadLabel(c.unread) : null;
  const title = c ? convTitle(c) : (name ?? "");
  return (
    <li>
      <button
        type="button"
        data-testid="conv-row"
        data-unread={unread ? "true" : "false"}
        aria-current={active ? "true" : undefined}
        disabled={busy}
        onClick={onOpen}
        className={cn(
          "flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left hover:bg-sunk focus-visible:bg-sunk focus-visible:outline-none",
          active && "bg-act-soft",
        )}
      >
        <span
          aria-hidden
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-act-soft text-[15px] font-semibold text-act"
        >
          {initialOf(title)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[14px]",
                unread ? "font-bold" : "font-medium",
              )}
            >
              {title}
            </span>
            {c?.last_message && (
              <time dateTime={c.last_message.at} className="shrink-0 text-micro text-dim">
                {listTime(c.last_message.at)}
              </time>
            )}
          </span>
          <span
            className={cn(
              "flex items-center gap-2 text-label",
              unread ? "font-semibold text-ink" : "text-dim",
            )}
          >
            {c && <Preview c={c} myId={myId} />}
            {c && n && (
              <span
                data-testid="conv-unread"
                role="img"
                aria-label={t("contracts.messages.unread", { n: c.unread })}
                className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-late px-1 text-micro font-semibold text-panel"
              >
                {n}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
