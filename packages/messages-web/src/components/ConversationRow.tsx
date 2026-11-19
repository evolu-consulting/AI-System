// CR-132 · W2 · một dòng danh sách. CR-190: avatar · tên (+ghim) · «chức vụ · công ty» · tin cuối hoặc «Chưa có tin nhắn» (không giờ) · số chưa đọc;
// «⋯» (máy tính: hiện khi rê chuột/focus; điện thoại: giữ lâu) = Ghim / Đánh dấu chưa đọc. Người chưa từng nhắn: bấm là mở cuộc, không có «⋯».
import type { ConversationSummary, MsgDirRow } from "@ai/contracts/pack-contracts";
import type { PersonCard } from "@ai/contracts/people";
import { Avatar } from "@ai/web-kit/ui/kit/avatar";
import { TruncText } from "@ai/web-kit/ui/kit/trunc-text";
import { PersonAvatar } from "@ai/web-kit/ui/PersonAvatar";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { IconFile, IconPin } from "../icons";
import { previewOf } from "../lib/conversations";
import { type DirRowView, dirRowView } from "../lib/dir-rows";
import { listTime } from "../lib/format";
import { cn } from "../ui";
import { PersonTip, usePersonTip } from "./PersonTip";
import { RowMenu, type RowMenuHandlers, useRowMenu } from "./RowMenu";

type T = ReturnType<typeof useTranslation>["t"];
function previewText(p: ReturnType<typeof previewOf>, t: T): string {
  if (p.kind === "deleted") return t("contracts.messages.previewDeleted");
  if (p.kind === "files") return t("contracts.messages.previewFiles");
  if (p.kind === "mine") return t("contracts.messages.previewMine", { text: p.text });
  if (p.kind !== "other") return "";
  return p.who ? t("contracts.messages.previewOther", { who: p.who, text: p.text }) : p.text;
}

function Preview({ c, myId }: { c: ConversationSummary | null; myId: string }) {
  const { t } = useTranslation();
  if (!c?.last_message)
    return (
      <span data-testid="conv-empty-msg" className="min-w-0 flex-1 truncate italic">
        {t("contracts.messages.noMessageYet")}
      </span>
    );
  const p = previewOf(c, myId);
  const text = previewText(p, t);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      {p.kind === "files" && <IconFile width={13} height={13} aria-hidden className="shrink-0" />}
      <TruncText text={text} focusable={false} className="min-w-0 flex-1" />
    </span>
  );
}

/** Chuyển động nhẹ CHỈ cho dòng vừa nhảy lên đầu (tắt khi người dùng chọn giảm chuyển động). */
function useBumpMotion(on: boolean) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { transform: "translateY(12px)", opacity: 0.4 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 220, easing: "ease-out" },
    );
  }, [on]);
  return ref;
}

function RowAvatar({ v, card }: { v: DirRowView; card: PersonCard | undefined }) {
  return v.isGroup ? (
    <Avatar name={v.title} kind="company" size={40} data-testid="conv-avatar" />
  ) : (
    <PersonAvatar
      name={v.title}
      id={v.personId}
      src={card?.avatar}
      size={40}
      testId="conv-avatar"
    />
  );
}

export type ConversationRowProps = {
  row: MsgDirRow;
  /** Hiện tên công ty ở dòng phụ (nhóm đối tác đã có tên công ty ở đầu nhóm ⇒ false). */
  showCompany: boolean;
  myId: string;
  active: boolean;
  onOpen: () => void;
  busy?: boolean;
  /** Thẻ người đã đọc theo lô (avatar + thẻ rê chuột); chưa về ⇒ chữ cái đầu. */
  card?: PersonCard | undefined;
  menu?: RowMenuHandlers | undefined;
  /** Dòng vừa nhảy lên đầu nhóm vì có tin. */
  bumped?: boolean;
};

export function ConversationRow(p: ConversationRowProps) {
  const { t } = useTranslation();
  const v = dirRowView(p.row, p.showCompany);
  const c = p.row.conversation;
  const tip = usePersonTip();
  const hv = v.isGroup ? {} : tip.hover;
  const li = useBumpMotion(p.bumped ?? false);
  const rm = useRowMenu(Boolean(c && p.menu));
  return (
    <li ref={li} {...rm.press} className="group relative" data-row-key={v.key}>
      <button
        {...tip.focus}
        type="button"
        data-testid="conv-row"
        data-unread={v.unread > 0 ? "true" : "false"}
        data-pinned={v.pinned ? "true" : "false"}
        aria-current={p.active ? "true" : undefined}
        disabled={p.busy}
        onClick={() => {
          if (!rm.swallowClick()) p.onOpen();
        }}
        className={cn(
          "flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left hover:bg-sunk focus-visible:bg-sunk focus-visible:outline-none",
          p.active && "bg-act-soft",
        )}
      >
        <span {...hv} className="shrink-0">
          <RowAvatar v={v} card={p.card} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
          <span className="flex min-w-0 items-baseline gap-2">
            <span {...hv} className="min-w-0 flex-1">
              <TruncText
                text={v.title}
                focusable={false}
                className={cn(
                  "block text-md text-foreground",
                  v.unread > 0 ? "font-semibold" : "font-medium",
                )}
              />
            </span>
            {v.pinned && (
              <span data-testid="conv-pin" role="img" aria-label={t("contracts.messages.pinned")}>
                <IconPin width={13} height={13} className="shrink-0 text-dim" />
              </span>
            )}
            {v.at && (
              <time dateTime={v.at} className="shrink-0 text-xs text-muted-foreground">
                {listTime(v.at)}
              </time>
            )}
          </span>
          {v.sub && (
            <span data-testid="conv-company-line" className="min-w-0 text-xs text-muted-foreground">
              <TruncText text={v.sub} focusable={false} className="min-w-0" />
            </span>
          )}
          <span
            className={cn(
              "flex min-w-0 items-center gap-2 text-sm",
              v.unread > 0 ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            <Preview c={c} myId={p.myId} />
            {v.unreadText && (
              <span
                data-testid="conv-unread"
                role="img"
                aria-label={t("contracts.messages.unread", { n: v.unread })}
                className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-late px-1 text-xs font-semibold text-panel"
              >
                {v.unreadText}
              </span>
            )}
          </span>
        </span>
      </button>
      {c && p.menu && (
        <RowMenu
          c={c}
          handlers={p.menu}
          open={rm.open}
          onOpenChange={rm.setOpen}
          label={t("contracts.messages.rowMore", { name: v.title })}
        />
      )}
      {!v.isGroup && tip.open && <PersonTip name={v.title} card={p.card} />}
    </li>
  );
}
