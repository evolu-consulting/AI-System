// CR-132 · W2 · dòng tin theo ngày (trình bày): tin của mình bên phải, tin đang gửi mờ, gửi lỗi bấm gửi lại, thu hồi tin của mình,
// «Đã xem» dưới tin cuối của mình, nút «Xem tin cũ hơn» (tải thêm 50).
import type { Message } from "@ai/contracts/pack-contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconTrash } from "~/components/icons";
import { cn } from "~/lib/utils";
import { dayLabel, timeLabel } from "../lib/format";
import { dayKey } from "../lib/message-pages";
import { canRevoke } from "../lib/perms";
import { type DayRows, mergeRows, type PendingMsg, type Row, stateOf } from "../lib/rows";
import { MessageFiles } from "./MessageFiles";

/** Tin đang gửi: `failed` = câu lỗi đã dịch (null = đang gửi). */
export type OutgoingView = PendingMsg;

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

type BubbleProps = {
  row: Row;
  mine: boolean;
  name: string;
  revokable: boolean;
  onRevoke: () => void;
  onRetry: () => void;
};

/** Nội dung bubble: chữ, tệp (tin thật) hoặc tên tệp (tin đang gửi), hoặc «đã thu hồi». */
function BubbleContent({ row }: { row: Row }) {
  const { t } = useTranslation();
  const m = row.kind === "sent" ? row.m : null;
  if (m?.deleted) return <>{t("contracts.messages.deleted")}</>;
  const body = m ? m.body : row.kind === "pending" ? row.p.body : "";
  const names = row.kind === "pending" ? row.p.fileNames : [];
  return (
    <>
      {body && <p className="m-0 whitespace-pre-wrap">{body}</p>}
      {m && <MessageFiles conv={m.conversation_id} files={m.files} />}
      {names.map((n) => (
        <span key={n} className="block truncate text-[12.5px]">
          {"📎 "}
          {n}
        </span>
      ))}
    </>
  );
}

/** Lớp phủ giờ + thu hồi (tuyệt đối ở góc bubble ⇒ không chiếm chỗ): rê chuột / focus trong tin / chạm tin. */
function Tools(p: {
  m: Message;
  mine: boolean;
  shown: boolean;
  revokable: boolean;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "absolute -top-3 z-10 flex items-center gap-1 rounded-md border border-rule bg-panel px-1.5 py-0.5 text-micro text-dim shadow-sm",
        "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
        p.shown && "opacity-100",
        p.mine ? "right-2" : "left-2",
      )}
      data-testid="msg-tools"
    >
      <time dateTime={p.m.at}>{timeLabel(p.m.at)}</time>
      {p.revokable && (
        <button
          type="button"
          onClick={p.onRevoke}
          aria-label={t("contracts.messages.revoke")}
          title={t("contracts.messages.revoke")}
          data-testid="msg-revoke"
          className="grid h-5 w-5 place-items-center rounded hover:bg-sunk hover:text-ink focus-visible:bg-sunk"
        >
          <IconTrash width={13} height={13} />
        </button>
      )}
    </span>
  );
}

/** Tin lỗi: giữ nguyên tin, nói lý do + nút «Gửi lại» (cùng client_id ⇒ server không tạo trùng). */
function RetryLine({ reason, onRetry }: { reason: string | null; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <p className="m-0 mt-1 flex items-center gap-2 text-micro text-late" role="alert">
      <span>{t("contracts.messages.sendFailed")}</span>
      <span className="sr-only">{reason}</span>
      <button
        type="button"
        onClick={onRetry}
        data-testid="msg-retry"
        className="rounded-md border border-late px-2 py-0.5 text-micro font-medium text-late hover:bg-late-bg"
      >
        {t("contracts.messages.resend")}
      </button>
    </p>
  );
}

const bubbleTone = (deleted: boolean, state: string, mine: boolean): string =>
  deleted
    ? "border border-rule bg-transparent italic text-dim"
    : state === "failed"
      ? "border border-late bg-transparent text-ink"
      : mine
        ? "bg-act text-on-act"
        : "bg-sunk text-ink";

/**
 * MỘT bubble cho cả tin đang gửi / lỗi / đã gửi (cùng cấu trúc, cùng khoá client_id ⇒ không remount, độ mờ chuyển mượt).
 * Chữ tin không xê dịch khi hover (lớp phủ tuyệt đối).
 */
function Bubble({ row, mine, name, revokable, onRevoke, onRetry }: BubbleProps) {
  const { t } = useTranslation();
  const state = stateOf(row);
  const [tapped, setTapped] = useState(false);
  const m = row.kind === "sent" ? row.m : null;
  return (
    <div
      className={cn("group flex w-full min-w-0 flex-col", mine ? "items-end" : "items-start")}
      data-testid={state === "sent" ? "msg-row" : "msg-outgoing"}
      data-mine={mine ? "true" : "false"}
      data-state={state}
    >
      {name && !mine && <span className="mb-0.5 px-1 text-micro text-dim">{name}</span>}
      <div className="relative max-w-[85%]">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: chạm vào tin để hiện giờ/thao tác trên cảm ứng; bàn phím dùng nút trong lớp phủ */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: xem trên */}
        <div
          onClick={() => setTapped((v) => !v)}
          className={cn(
            "min-w-0 rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed transition-opacity duration-300 [overflow-wrap:anywhere]",
            bubbleTone(m?.deleted === true, state, mine),
            state === "sending" && "opacity-60",
          )}
        >
          <BubbleContent row={row} />
          {state === "sending" && (
            <span className="sr-only"> {t("contracts.messages.sending")}</span>
          )}
        </div>
        {m && <Tools m={m} mine={mine} shown={tapped} revokable={revokable} onRevoke={onRevoke} />}
      </div>
      {state === "failed" && row.kind === "pending" && (
        <RetryLine reason={row.p.failed} onRetry={onRetry} />
      )}
    </div>
  );
}

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

export function MessageList(p: MessageListProps) {
  const { t } = useTranslation();
  const end = useRef<HTMLDivElement>(null);
  const lastSeq = p.items[p.items.length - 1]?.seq ?? 0;
  const failedN = p.outgoing.filter((o) => o.failed).length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: cuộn xuống khi có tin mới/đang gửi/gửi lỗi (hiện «Gửi lại»), KHÔNG cuộn khi tải tin cũ
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [lastSeq, p.outgoing.length, failedN]);
  const groups = mergeRows(p.items, p.outgoing, dayKey(new Date().toISOString()));
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
        <div key={g.day} className="space-y-3">
          <DayBar iso={dayStart(g)} />
          {g.rows.map((r) => {
            const m = r.kind === "sent" ? r.m : null;
            return (
              <Bubble
                key={r.key}
                row={r}
                mine={m ? m.sender_id === p.myId : true}
                name={m && p.group ? p.nameOf(m.sender_id) : ""}
                revokable={m ? canRevoke(m, p.myId) : false}
                onRevoke={() => m && p.onRevoke(m.seq)}
                onRetry={() => r.kind === "pending" && p.onRetry(r.p.clientId)}
              />
            );
          })}
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
