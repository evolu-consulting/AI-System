// CR-132 · W2 · khung chat một hội thoại (toàn màn và khoang hẹp ở W3): đầu (‹ về danh sách khi có `onBack`, tên, «n thành viên»),
// dòng tin, ô soạn. `compact` ⇒ đầu gọn, không viền ngoài. Không còn trong hội thoại (404) ⇒ câu «Bạn không còn trong cuộc trò chuyện này.».
import type { ConversationDetail } from "@ai/contracts/pack-contracts";
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { toast } from "@ai/web-kit/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronLeft } from "~/components/icons";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { msgKeys } from "../api";
import { useConversation, useMarkRead, useMessages, useOutbox, useRevoke } from "../hooks/use-chat";
import { convTitle } from "../lib/conversations";
import { errorKey, isGone } from "../lib/errors";
import { lastMineSeq, seenCount } from "../lib/message-pages";
import { composerLocked } from "../lib/perms";
import { GroupMembersSheet } from "./GroupMembersSheet";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";

export type ChatViewProps = {
  conversationId: string;
  myId: string;
  /** Có ⇒ hiện nút ‹ về danh sách (khoang hẹp / điện thoại). */
  onBack?: () => void;
  compact?: boolean;
  /** Lớp CSS thêm cho nút ‹ (vd `md:hidden` ở toàn màn hai cột). */
  backClass?: string;
};

function ChatError({
  gone,
  titleKey,
  onBack,
  onRetry,
}: {
  gone: boolean;
  titleKey: string;
  onBack?: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (gone)
    return (
      <EmptyState
        kind="notFound"
        testId="chat-gone"
        title={t("contracts.messages.removedTitle")}
        hint={t("contracts.messages.removedHint")}
        action={
          <button type="button" className="btn btn-sm" onClick={() => onBack?.()}>
            {t("contracts.messages.back")}
          </button>
        }
      />
    );
  return (
    <EmptyState
      kind="error"
      title={t(titleKey)}
      action={
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          {t("contracts.messages.retry")}
        </button>
      }
    />
  );
}

function ChatHeader({
  title,
  members,
  onBack,
  backClass,
  compact,
  onMembers,
}: {
  title: string;
  members: number | null;
  onBack?: () => void;
  backClass?: string;
  compact?: boolean;
  onMembers: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-rule-soft",
        compact ? "h-12 px-2" : "h-14 px-4",
      )}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={t("contracts.messages.back")}
          title={t("contracts.messages.back")}
          data-testid="chat-back"
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-dim hover:bg-sunk hover:text-ink",
            backClass,
          )}
        >
          <IconChevronLeft width={18} height={18} />
        </button>
      )}
      <h2
        className="m-0 min-w-0 flex-1 truncate text-[14.5px] font-semibold"
        data-testid="chat-title"
      >
        {title}
      </h2>
      {members !== null && (
        <button type="button" className="btn btn-sm" onClick={onMembers} data-testid="chat-members">
          {t("contracts.messages.members", { n: members })}
        </button>
      )}
    </header>
  );
}

/** Hỏi lại rồi thu hồi tin của mình (toast kết quả). */
function useRevokeAction(id: string) {
  const { t } = useTranslation();
  const revoke = useRevoke(id);
  return async (seq: number) => {
    const ok = await confirmDialog({
      title: t("contracts.messages.revoke"),
      body: t("contracts.messages.revokeConfirm"),
      danger: true,
    });
    if (!ok) return;
    revoke.mutate(seq, {
      onSuccess: () => toast(t("contracts.messages.revoked"), "ok"),
      onError: (e) => toast(t(errorKey(e)), "late"),
    });
  };
}

type Msgs = ReturnType<typeof useMessages>;
type Box = ReturnType<typeof useOutbox>;

/** Phần giữa: đang tải · trống · dòng tin. */
function ChatBody({
  d,
  msgs,
  box,
  myId,
}: {
  d: ConversationDetail | undefined;
  msgs: Msgs;
  box: Box;
  myId: string;
}) {
  const { t } = useTranslation();
  const doRevoke = useRevokeAction(d?.id ?? "");
  const outgoing = box.outgoing.map((o) => ({
    clientId: o.clientId,
    body: o.body,
    fileNames: o.fileNames,
    failed: o.failed ? t(o.failed) : null,
  }));
  if (!d || msgs.isPending)
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="ml-auto h-8 w-1/2" />
        <Skeleton className="h-8 w-3/5" />
      </div>
    );
  if (msgs.items.length === 0 && outgoing.length === 0)
    return (
      <div
        className="grid min-h-0 flex-1 place-items-center p-6 text-center text-[13.5px] text-dim"
        data-testid="chat-empty"
      >
        {t("contracts.messages.emptyChat")}
      </div>
    );
  return (
    <MessageList
      items={msgs.items}
      outgoing={outgoing}
      myId={myId}
      group={d.kind === "group"}
      nameOf={(uid) => d.members.find((m) => m.user_id === uid)?.name ?? ""}
      seenN={seenCount(lastMineSeq(msgs.items, myId), d.members, myId)}
      hasOlder={msgs.hasNextPage}
      loadingOlder={msgs.isFetchingNextPage}
      onOlder={() => void msgs.fetchNextPage()}
      onRevoke={(s) => void doRevoke(s)}
      onRetry={box.retry}
    />
  );
}

export function ChatView({ conversationId: id, myId, onBack, compact, backClass }: ChatViewProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const conv = useConversation(id);
  const msgs = useMessages(id);
  const box = useOutbox(id, myId);
  const [sheet, setSheet] = useState(false);
  const last = msgs.items[msgs.items.length - 1]?.seq ?? null;
  useMarkRead(id, conv.data ? last : null, myId);

  if (conv.isError || msgs.isError)
    return (
      <ChatError
        gone={conv.isError && isGone(conv.error)}
        titleKey={conv.isError ? errorKey(conv.error) : "contracts.messages.loadError"}
        onBack={onBack}
        onRetry={() => {
          void conv.refetch();
          void msgs.refetch();
        }}
      />
    );
  const d = conv.data;
  return (
    <section
      aria-label={d ? convTitle(d) : t("contracts.messages.title")}
      data-testid="chat-view"
      className={cn("flex h-full min-h-0 flex-col bg-panel", !compact && "border-l border-rule")}
    >
      <ChatHeader
        title={d ? convTitle(d) : ""}
        members={d?.kind === "group" ? d.member_count : null}
        onBack={onBack}
        backClass={backClass}
        compact={compact}
        onMembers={() => setSheet(true)}
      />
      <ChatBody d={d} msgs={msgs} box={box} myId={myId} />
      {d && (
        <MessageComposer
          conversationId={id}
          onSend={box.send}
          lockedReason={composerLocked(d) ? t("contracts.messages.peerGone") : null}
        />
      )}
      {d?.kind === "group" && (
        <GroupMembersSheet
          open={sheet}
          detail={d}
          myId={myId}
          onClose={() => setSheet(false)}
          onLeft={() => {
            setSheet(false);
            qc.removeQueries({ queryKey: msgKeys.detail(id) });
            qc.removeQueries({ queryKey: msgKeys.msgs(id) });
            void qc.invalidateQueries({ queryKey: msgKeys.list });
            void qc.invalidateQueries({ queryKey: msgKeys.unread });
            onBack?.();
          }}
        />
      )}
    </section>
  );
}
