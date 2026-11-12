// CR-132 · W2 · dòng tin theo ngày (trình bày): tin của mình bên phải, tin đang gửi mờ, gửi lỗi bấm gửi lại, thu hồi tin của mình,
// «Đã xem» dưới tin cuối của mình, nút «Xem tin cũ hơn» (tải thêm 50).
import type { Message } from "@ai/contracts/pack-contracts";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { IconTrash } from "~/components/icons";
import { cn } from "~/lib/utils";
import { dayLabel, timeLabel } from "../lib/format";
import { groupByDay } from "../lib/message-pages";
import { canRevoke } from "../lib/perms";
import { MessageFiles } from "./MessageFiles";

export type OutgoingView = {
  clientId: string;
  body: string;
  fileNames: readonly string[];
  failedText: string | null;
};

export type MessageListProps = {
  items: readonly Message[];
  outgoing: readonly OutgoingView[];
  myId: string;
  group: boolean;
  nameOf: (userId: string) => string;
  seenN: number;
  hasOlder: boolean;
  loadingOlder: boolean;
  onOlder: () => void;
  onRevoke: (seq: number) => void;
  onRetry: (clientId: string) => void;
};

function Bubble({
  m,
  mine,
  name,
  revokable,
  onRevoke,
}: {
  m: Message;
  mine: boolean;
  name: string;
  revokable: boolean;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn("group flex w-full min-w-0 flex-col", mine ? "items-end" : "items-start")}
      data-testid="msg-row"
      data-mine={mine ? "true" : "false"}
    >
      {name && !mine && <span className="mb-0.5 px-1 text-micro text-dim">{name}</span>}
      <div className={cn("flex max-w-[85%] items-end gap-1.5", mine && "flex-row-reverse")}>
        <div
          className={cn(
            "min-w-0 rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed [overflow-wrap:anywhere]",
            m.deleted
              ? "border border-rule bg-transparent italic text-dim"
              : mine
                ? "bg-act text-on-act"
                : "bg-sunk text-ink",
          )}
        >
          {m.deleted ? (
            t("contracts.messages.deleted")
          ) : (
            <>
              {m.body && <p className="m-0 whitespace-pre-wrap">{m.body}</p>}
              <MessageFiles conv={m.conversation_id} files={m.files} />
            </>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1 pb-0.5 text-micro text-dim">
          <time dateTime={m.at}>{timeLabel(m.at)}</time>
          {revokable && (
            <button
              type="button"
              onClick={onRevoke}
              aria-label={t("contracts.messages.revoke")}
              title={t("contracts.messages.revoke")}
              data-testid="msg-revoke"
              className="grid h-6 w-6 place-items-center rounded-md hover:bg-sunk hover:text-ink focus-visible:bg-sunk"
            >
              <IconTrash width={14} height={14} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

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

export function MessageList(p: MessageListProps) {
  const { t } = useTranslation();
  const end = useRef<HTMLDivElement>(null);
  const lastSeq = p.items[p.items.length - 1]?.seq ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: cuộn xuống khi có tin mới/đang gửi, KHÔNG cuộn khi tải tin cũ
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [lastSeq, p.outgoing.length]);
  const groups = groupByDay(p.items);
  return (
    <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3" data-testid="msg-list">
      {p.hasOlder && (
        <div className="text-center">
          <button
            type="button"
            disabled={p.loadingOlder}
            onClick={p.onOlder}
            className="btn btn-sm"
          >
            {t("contracts.messages.loadOlder")}
          </button>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.day} className="space-y-1.5">
          <DayBar iso={g.items[0]?.at ?? ""} />
          {g.items.map((m) => (
            <Bubble
              key={m.seq}
              m={m}
              mine={m.sender_id === p.myId}
              name={p.group ? p.nameOf(m.sender_id) : ""}
              revokable={canRevoke(m, p.myId)}
              onRevoke={() => p.onRevoke(m.seq)}
            />
          ))}
        </div>
      ))}
      {p.outgoing.map((o) => (
        <div key={o.clientId} className="flex flex-col items-end" data-testid="msg-outgoing">
          {o.failedText ? (
            <button
              type="button"
              onClick={() => p.onRetry(o.clientId)}
              className="max-w-[85%] rounded-2xl border border-late px-3.5 py-2 text-left text-[13.5px] [overflow-wrap:anywhere]"
            >
              <span className="block whitespace-pre-wrap">{o.body}</span>
              {o.fileNames.map((n) => (
                <span key={n} className="block truncate text-[12.5px]">
                  {"📎 "}
                  {n}
                </span>
              ))}
              <span className="block text-micro text-late">
                {t("contracts.messages.sendFailed")}
              </span>
              <span className="sr-only">{o.failedText}</span>
            </button>
          ) : (
            <p
              aria-live="polite"
              className="m-0 max-w-[85%] whitespace-pre-wrap rounded-2xl bg-act px-3.5 py-2 text-[13.5px] text-on-act opacity-60 [overflow-wrap:anywhere]"
            >
              {o.body}
              {o.fileNames.map((n) => (
                <span key={n} className="block truncate text-[12.5px]">
                  {"📎 "}
                  {n}
                </span>
              ))}
              <span className="sr-only"> {t("contracts.messages.sending")}</span>
            </p>
          )}
        </div>
      ))}
      {p.seenN > 0 && p.outgoing.length === 0 && (
        <p data-testid="msg-seen" className="m-0 text-right text-micro text-dim">
          {p.group ? t("contracts.messages.seenN", { n: p.seenN }) : t("contracts.messages.seen")}
        </p>
      )}
      <div ref={end} />
    </div>
  );
}
