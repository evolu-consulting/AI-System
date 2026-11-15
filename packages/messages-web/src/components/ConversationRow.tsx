// CR-132 · W2 · một dòng danh sách: avatar/tên/xem trước/giờ, chưa đọc ⇒ in đậm + số. CR-132b: dòng «Thành viên» chưa có 1-1 (`c` null) bấm là mở/tạo.

import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import type { PersonCard } from "@ai/contracts/people";
import { PersonAvatar } from "@ai/web-kit/ui/PersonAvatar";
import { useTranslation } from "react-i18next";
import { convTitle, isUnread, partnerSubtitle, previewOf, unreadLabel } from "../lib/conversations";
import { listTime } from "../lib/format";
import { cn } from "../ui";
import { PersonTip, usePersonTip } from "./PersonTip";

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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: một dòng trình bày (nhãn xem trước/chưa đọc/thẻ người), tách thêm chỉ làm khó đọc
export function ConversationRow({
  c,
  name,
  myId,
  active,
  onOpen,
  busy = false,
  card,
}: {
  c: ConversationSummary | null;
  /** Tên hiện khi chưa có hội thoại (thành viên chưa nhắn). */
  name?: string;
  myId: string;
  active: boolean;
  onOpen: () => void;
  busy?: boolean;
  /** Thẻ người đã đọc theo lô (avatar + thẻ rê chuột); chưa về ⇒ chữ cái đầu. */
  card?: PersonCard | undefined;
}) {
  const { t } = useTranslation();
  const unread = c ? isUnread(c) : false;
  const n = c ? unreadLabel(c.unread) : null;
  const title = c ? convTitle(c) : (name ?? "");
  const isPerson = !c || c.kind === "direct";
  // CR-169 · cuộc `partner`: nhãn phụ «Chức vụ · Công ty»; thẻ người (avatar/phòng ban) chỉ có cho đồng nghiệp cùng công ty.
  const sub = c ? partnerSubtitle(c) : "";
  const tip = usePersonTip();
  const hv = isPerson ? tip.hover : {};
  return (
    <li className="relative">
      <button
        {...tip.focus}
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
        <span {...hv} className="shrink-0">
          <PersonAvatar
            name={title}
            src={isPerson ? card?.avatar : null}
            size={40}
            testId="conv-avatar"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              {...hv}
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
          {sub && (
            <span data-testid="conv-company" className="block truncate text-micro text-dim">
              {sub}
            </span>
          )}
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
      {isPerson && tip.open && <PersonTip name={title} card={card} />}
    </li>
  );
}
