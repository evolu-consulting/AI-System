// CR-132 · W2 · một dòng danh sách. CR-179: 3 dòng — (1) tên người + giờ, (2) «[toà nhà] công ty · chức vụ» chữ phụ không nền,
// (3) xem trước tin cuối (chưa đọc ⇒ chữ chính đậm + số). CR-132b: dòng «Thành viên» chưa có 1-1 (`c` null) bấm là mở/tạo.

import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import type { PersonCard } from "@ai/contracts/people";
import { Avatar } from "@ai/web-kit/ui/kit/avatar";
import { TruncText } from "@ai/web-kit/ui/kit/trunc-text";
import { useTranslation } from "react-i18next";
import { IconBuilding, IconFile } from "../icons";
import { convTitle, isUnread, previewOf, unreadLabel } from "../lib/conversations";
import { listTime } from "../lib/format";
import { avatarNameOf, metaLineOf } from "../lib/row-view";
import { cn } from "../ui";
import { PersonTip, usePersonTip } from "./PersonTip";

type T = ReturnType<typeof useTranslation>["t"];
function previewText(p: ReturnType<typeof previewOf>, t: T): string {
  if (p.kind === "deleted") return t("contracts.messages.previewDeleted");
  if (p.kind === "files") return t("contracts.messages.previewFiles");
  if (p.kind === "mine") return t("contracts.messages.previewMine", { text: p.text });
  if (p.kind !== "other") return "";
  return p.who ? t("contracts.messages.previewOther", { who: p.who, text: p.text }) : p.text;
}

function Preview({ c, myId }: { c: ConversationSummary; myId: string }) {
  const { t } = useTranslation();
  const p = previewOf(c, myId);
  const text = previewText(p, t);
  if (p.kind === "files")
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <IconFile width={13} height={13} aria-hidden className="shrink-0" />
        <TruncText text={text} focusable={false} className="min-w-0 flex-1" />
      </span>
    );
  return <TruncText text={text} focusable={false} className="min-w-0 flex-1" />;
}

/** Dòng 2: «[toà nhà] Công ty · Chức vụ» — chữ phụ 12px, không nền; thiếu phần nào thì bỏ phần đó (không «·» thừa, không icon khi thiếu công ty). */
function MetaLine({ company, job }: { company: string; job: string }) {
  const text = company && job ? `${company} · ${job}` : company || job;
  return (
    <span
      data-testid="conv-company-line"
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
    >
      {company && <IconBuilding width={12} height={12} aria-hidden className="shrink-0" />}
      <TruncText text={text} focusable={false} className="min-w-0 flex-1" />
      {/* giữ mốc cho e2e cũ: tên công ty / chức vụ đọc được riêng */}
      {company && (
        <span data-testid="conv-company" className="sr-only">
          {company}
        </span>
      )}
      {job && (
        <span data-testid="conv-job" className="sr-only">
          {job}
        </span>
      )}
    </span>
  );
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
  const meta = metaLineOf(c);
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
          <Avatar
            name={avatarNameOf(title)}
            kind="person"
            src={isPerson || c?.kind === "partner" ? card?.avatar : null}
            size={40}
            data-testid="conv-avatar"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span {...hv} className="min-w-0 flex-1">
              <TruncText
                text={title}
                focusable={false}
                className="block text-md font-medium text-foreground"
              />
            </span>
            {c?.last_message && (
              <time dateTime={c.last_message.at} className="shrink-0 text-xs text-muted-foreground">
                {listTime(c.last_message.at)}
              </time>
            )}
          </span>
          {meta && <MetaLine company={meta.company} job={meta.job} />}
          {c && (
            <span
              className={cn(
                "flex min-w-0 items-center gap-2 text-sm",
                unread ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              <Preview c={c} myId={myId} />
              {n && (
                <span
                  data-testid="conv-unread"
                  role="img"
                  aria-label={t("contracts.messages.unread", { n: c.unread })}
                  className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-late px-1 text-xs font-semibold text-panel"
                >
                  {n}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
      {isPerson && tip.open && <PersonTip name={title} card={card} />}
    </li>
  );
}
