// CR-132 · W2 · dòng tin theo ngày (trình bày): tin của mình bên phải, tin đang gửi mờ, gửi lỗi bấm gửi lại, nút tải dần 30 tin/lần (CR-148).
// CR-178 · gộp tin liên tiếp cùng người (avatar + tên một lần, giờ dưới tin cuối nhóm), vạch «Tin chưa đọc» tại mốc đọc lúc mở cuộc,
// nút nổi «↓ n tin mới» khi đang cuộn lên, «Đã xem» bằng avatar nhỏ (nhóm: tối đa 3 + «+N»).
import type { Message } from "@ai/contracts/pack-contracts";
import type { PersonCard } from "@ai/contracts/people";
import { Avatar, AvatarGroup } from "@ai/web-kit/ui/kit/avatar";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  groupRows,
  groupTime,
  newBelowCount,
  type RowGroup,
  unreadDividerSeq,
} from "../lib/chat-view";
import { dayLabel, timeLabel } from "../lib/format";
import { dayKey } from "../lib/message-pages";
import { type DayRows, mergeRows, type PendingMsg } from "../lib/rows";
import { cn } from "../ui";
import { Bubble } from "./MessageBubble";

/** Tin đang gửi: `failed` = câu lỗi đã dịch (null = đang gửi). */
export type OutgoingView = PendingMsg;

export type SeenPerson = { name: string; src?: string | null | undefined };

export type MessageListProps = {
  items: readonly Message[];
  outgoing: readonly OutgoingView[];
  myId: string;
  group: boolean;
  nameOf: (userId: string) => string;
  /** Thẻ người theo lô (avatar người gửi); chưa về ⇒ chữ cái đầu. */
  cardOf?: (userId: string) => PersonCard | undefined;
  /** Mốc đọc của mình lúc mở cuộc (vạch «Tin chưa đọc»); chưa biết ⇒ null. */
  readAt: number | null;
  /** Người khác đã đọc tới tin cuối của mình. */
  seen: readonly SeenPerson[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onOlder: () => void;
  onRevoke: (seq: number) => void;
  onRetry: (clientId: string) => void;
};

/** ISO một mốc của nhóm ngày (nhãn Hôm nay/Hôm qua/ngày): tin thật đầu tiên; chỉ có tin đang gửi ⇒ bây giờ. */
const dayStart = (g: DayRows): string => {
  const f = g.rows[0];
  return f?.kind === "sent" ? f.m.at : new Date().toISOString();
};

function DayBar({ iso }: { iso: string }) {
  const { t } = useTranslation();
  const d = dayLabel(iso);
  const text =
    d.kind === "today"
      ? t("contracts.messages.today")
      : d.kind === "yesterday"
        ? t("contracts.messages.yesterday")
        : d.text;
  return (
    <div className="my-3 flex items-center gap-3 text-micro text-dim">
      <span className="h-px flex-1 bg-rule-soft" />
      {text}
      <span className="h-px flex-1 bg-rule-soft" />
    </div>
  );
}

function UnreadBar() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="msg-unread-divider"
      className="my-2 flex items-center gap-3 text-micro font-semibold text-late"
    >
      <span className="h-px flex-1 bg-late" />
      {t("contracts.messages.unreadDivider")}
      <span className="h-px flex-1 bg-late" />
    </div>
  );
}

/** Một nhóm tin cùng người: avatar + tên một lần (tin người khác), các bubble, giờ dưới tin cuối. */
function MessageGroup({ g, p }: { g: RowGroup; p: MessageListProps }) {
  const time = groupTime(g);
  const name = g.mine ? "" : p.nameOf(g.senderId);
  return (
    <div
      data-testid="msg-group"
      data-mine={g.mine ? "true" : "false"}
      className={cn("flex min-w-0 gap-2", g.mine ? "justify-end" : "justify-start")}
    >
      {!g.mine && (
        <Avatar
          name={name}
          src={p.cardOf?.(g.senderId)?.avatar}
          size={24}
          data-testid="msg-avatar"
          className="mt-0.5"
        />
      )}
      <div
        className={cn("flex min-w-0 flex-1 flex-col gap-0.5", g.mine ? "items-end" : "items-start")}
      >
        {p.group && name && <span className="text-micro text-dim">{name}</span>}
        {g.rows.map((r) => {
          const m = r.kind === "sent" ? r.m : null;
          return (
            <Bubble
              key={r.key}
              row={r}
              mine={g.mine}
              myId={p.myId}
              onRevoke={() => m && p.onRevoke(m.seq)}
              onRetry={() => r.kind === "pending" && p.onRetry(r.p.clientId)}
            />
          );
        })}
        {time && (
          <time dateTime={time} data-testid="msg-time" className="text-micro text-dim">
            {timeLabel(time)}
          </time>
        )}
      </div>
    </div>
  );
}

const NEAR_BOTTOM_PX = 80;

/** Cuộn của dòng tin: mở cuộc tới vạch chưa đọc (hoặc đáy), tin mới khi đang đọc lên trên ⇒ nút «↓ n tin mới», tải tin cũ giữ vị trí (CR-148). */
function useChatScroll(p: MessageListProps, mark: number | null) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const firstSeq = p.items[0]?.seq ?? 0;
  const lastSeq = p.items[p.items.length - 1]?.seq ?? 0;
  const keep = useRef<{ seq: number; h: number } | null>(null);
  const atBottom = useRef(mark === null);
  const opened = useRef(false);
  const [away, setAway] = useState(false);
  const [seenSeq, setSeenSeq] = useState(lastSeq);
  useLayoutEffect(() => {
    const el = box.current;
    const k = keep.current;
    if (el && k && firstSeq && firstSeq < k.seq) el.scrollTop += el.scrollHeight - k.h;
    keep.current = el ? { seq: firstSeq, h: el.scrollHeight } : null;
  }, [firstSeq]);
  const older = () => {
    const el = box.current;
    if (el) keep.current = { seq: firstSeq, h: el.scrollHeight };
    p.onOlder();
  };
  const toEnd = () => {
    end.current?.scrollIntoView?.({ block: "end" });
    atBottom.current = true;
    setAway(false);
    setSeenSeq(lastSeq);
  };
  const hasItems = p.items.length > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: chạy một lần khi tin đầu tiên về
  useEffect(() => {
    if (opened.current || !hasItems) return;
    opened.current = true;
    if (mark !== null && bar.current) {
      bar.current.scrollIntoView?.({ block: "start" });
      setSeenSeq(lastSeq);
    } else toEnd();
  }, [hasItems]);
  const failedN = p.outgoing.filter((o) => o.failed).length;
  const lastMine = p.items[p.items.length - 1]?.sender_id === p.myId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: tin mới/đang gửi/gửi lỗi: ở đáy hoặc tin của mình ⇒ cuộn xuống; đang đọc lên trên ⇒ giữ chỗ + nút «n tin mới»
  useEffect(() => {
    if (!opened.current) return;
    if (atBottom.current || lastMine || p.outgoing.length > 0) toEnd();
    else setAway(true);
  }, [lastSeq, p.outgoing.length, failedN]);
  const onScroll = (el: HTMLDivElement) => {
    if (el.scrollTop < NEAR_BOTTOM_PX && p.hasOlder && !p.loadingOlder) older();
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottom.current = near;
    if (near && away) {
      setAway(false);
      setSeenSeq(lastSeq);
    }
  };
  const newN = away ? newBelowCount(p.items, seenSeq, p.myId) : 0;
  return { box, end, bar, older, toEnd, onScroll, newN };
}

export function MessageList(p: MessageListProps) {
  const { t } = useTranslation();
  // Vạch chỉ tính MỘT lần theo mốc lúc mở (tin tới sau không đẩy vạch).
  const first = useRef<number | null | undefined>(undefined);
  if (first.current === undefined && p.items.length > 0)
    first.current = unreadDividerSeq(p.items, p.readAt, p.myId);
  const mark = first.current ?? null;
  const s = useChatScroll(p, mark);
  const days = mergeRows(p.items, p.outgoing, dayKey(new Date().toISOString()));
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={s.box}
        onScroll={(e) => s.onScroll(e.currentTarget)}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3"
        data-testid="msg-list"
      >
        {p.hasOlder && (
          <div className="text-center">
            <button
              type="button"
              disabled={p.loadingOlder}
              onClick={s.older}
              className="btn btn-sm"
            >
              {t("contracts.messages.loadOlder")}
            </button>
          </div>
        )}
        {days.map((d) => (
          <div key={d.day} className="space-y-3">
            <DayBar iso={dayStart(d)} />
            {groupRows(d.rows, p.myId, mark).map((grp) => {
              const f = grp.rows[0];
              const isMark = mark !== null && f?.kind === "sent" && f.m.seq === mark;
              return (
                <div key={grp.key} ref={isMark ? s.bar : undefined}>
                  {isMark && <UnreadBar />}
                  <MessageGroup g={grp} p={p} />
                </div>
              );
            })}
          </div>
        ))}
        {p.seen.length > 0 && p.outgoing.length === 0 && (
          <div
            data-testid="msg-seen"
            role="img"
            aria-label={t("contracts.messages.seenBy", {
              names: p.seen.map((x) => x.name).join(", "),
            })}
            className="flex justify-end"
          >
            <AvatarGroup people={p.seen.map((x) => ({ name: x.name, src: x.src }))} size={24} />
          </div>
        )}
        <div ref={s.end} />
      </div>
      {s.newN > 0 && (
        <button
          type="button"
          data-testid="msg-new-below"
          onClick={s.toEnd}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-act px-3 py-1.5 text-label font-semibold text-on-act shadow-md"
        >
          {t("contracts.messages.newBelow", { n: s.newN })}
        </button>
      )}
    </div>
  );
}
