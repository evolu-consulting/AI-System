// CR-178 · một bubble tin (đã gửi / đang gửi / lỗi) + nút «⋯» (Sao chép · Thu hồi). Tên, avatar, giờ do nhóm tin (`MessageList`) vẽ một lần.
// «⋯» hiện khi rê chuột / focus trên máy tính; trên điện thoại giữ tay ~0,5 giây vào tin để mở cùng menu.
import type { Message } from "@ai/contracts/pack-contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai/web-kit/ui/kit/dropdown-menu";
import { toast } from "@ai/web-kit/ui/toast";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconMore } from "../icons";
import { type MessageAction, messageActions } from "../lib/chat-view";
import { type Row, stateOf } from "../lib/rows";
import { cn } from "../ui";
import { MessageFiles } from "./MessageFiles";

export const LONG_PRESS_MS = 500;

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

/** «⋯»: Sao chép (clipboard + toast) · Thu hồi (chỉ tin của mình; cha hỏi lại trước khi thu hồi). */
function MessageMenu({
  m,
  actions,
  open,
  onOpenChange,
  onRevoke,
}: {
  m: Message;
  actions: readonly MessageAction[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.body);
      toast(t("contracts.messages.copied"), "ok");
    } catch {
      toast(t("contracts.messages.copyFailed"), "late");
    }
  };
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("contracts.messages.msgMore")}
          title={t("contracts.messages.msgMore")}
          data-testid="msg-more"
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-md text-dim hover:bg-sunk hover:text-ink focus-visible:bg-sunk",
            "opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/b:opacity-100 group-hover/b:opacity-100 data-[state=open]:opacity-100",
          )}
        >
          <IconMore width={16} height={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="msg-menu">
        {actions.includes("copy") && (
          <DropdownMenuItem data-testid="msg-copy" onSelect={() => void copy()}>
            {t("contracts.messages.copy")}
          </DropdownMenuItem>
        )}
        {actions.includes("revoke") && (
          <DropdownMenuItem danger data-testid="msg-revoke" onSelect={onRevoke}>
            {t("contracts.messages.revoke")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type BubbleProps = {
  row: Row;
  mine: boolean;
  myId: string;
  onRevoke: () => void;
  onRetry: () => void;
};

/** MỘT bubble cho cả tin đang gửi / lỗi / đã gửi (cùng cấu trúc, cùng khoá client_id ⇒ không remount). */
export function Bubble({ row, mine, myId, onRevoke, onRetry }: BubbleProps) {
  const { t } = useTranslation();
  const state = stateOf(row);
  const m = row.kind === "sent" ? row.m : null;
  const actions = m ? messageActions(m, myId) : [];
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const press = () => {
    cancel();
    if (actions.length > 0) timer.current = setTimeout(() => setOpen(true), LONG_PRESS_MS);
  };
  return (
    <div
      className={cn(
        "group/b flex w-full min-w-0 flex-col rounded-xl",
        "data-[flash=true]:ring-2 data-[flash=true]:ring-act motion-safe:data-[flash=true]:animate-pulse",
        mine ? "items-end" : "items-start",
      )}
      data-testid={state === "sent" ? "msg-row" : "msg-outgoing"}
      data-mine={mine ? "true" : "false"}
      data-state={state}
      data-seq={m?.seq}
    >
      <div className={cn("flex max-w-[85%] items-center gap-1", mine && "flex-row-reverse")}>
        <div
          onTouchStart={press}
          onTouchEnd={cancel}
          onTouchMove={cancel}
          onTouchCancel={cancel}
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
        {m && actions.length > 0 && (
          <MessageMenu
            m={m}
            actions={actions}
            open={open}
            onOpenChange={setOpen}
            onRevoke={onRevoke}
          />
        )}
      </div>
      {state === "failed" && row.kind === "pending" && (
        <RetryLine reason={row.p.failed} onRetry={onRetry} />
      )}
    </div>
  );
}
