// CR-132 · W2 · khung chat một hội thoại (toàn màn và khoang hẹp ở W3): đầu (‹ về danh sách khi có `onBack`, tên, «n thành viên»),
// dòng tin, ô soạn. `compact` ⇒ đầu gọn, không viền ngoài. Không còn trong hội thoại (404) ⇒ câu «Bạn không còn trong cuộc trò chuyện này.».
import type { ConversationDetail } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { type MutableRefObject, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { msgKeys } from "../api";
import { useConversation, useMarkRead, useMessages, useOutbox, useRevoke } from "../hooks/use-chat";
import { useJump } from "../hooks/use-jump";
import { usePersonCards } from "../hooks/use-person-cards";
import { seenPeople } from "../lib/chat-view";
import { convTitle } from "../lib/conversations";
import { errorKey, isGone } from "../lib/errors";
import { lastMineSeq } from "../lib/message-pages";
import { composerLocked } from "../lib/perms";
import { cn, confirmDialog, Skeleton } from "../ui";
import { ChatError, ChatHeader, ChatTop } from "./ChatParts";
import { DropOverlay, useFileDrop } from "./file-drop";
import { GroupMembersSheet } from "./GroupMembersSheet";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";
import { ReadOnlyNotice } from "./ReadOnlyNotice";

export type ChatViewProps = {
  conversationId: string;
  myId: string;
  /** Có ⇒ hiện nút ‹ về danh sách (khoang hẹp / điện thoại). */
  onBack?: () => void;
  compact?: boolean;
  /** Lớp CSS thêm cho nút ‹ (vd `md:hidden` ở toàn màn hai cột). */
  backClass?: string;
};

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

/** Mốc đọc của mình LÚC MỞ cuộc (chụp một lần theo cuộc; đọc xong cũng không đổi) — vị trí vạch «Tin chưa đọc». */
function useOpenReadMark(
  id: string,
  d: ConversationDetail | undefined,
  myId: string,
): number | null {
  const ref = useRef<{ id: string; seq: number | null } | null>(null);
  if (d && d.id === id && ref.current?.id !== id)
    ref.current = { id, seq: d.members.find((m) => m.user_id === myId)?.last_read_seq ?? null };
  return ref.current?.id === id ? ref.current.seq : null;
}

const partnerJob = (d: ConversationDetail | undefined): string =>
  d?.kind === "partner" ? (d.peer?.job_title ?? "") : "";
const partnerCompany = (d: ConversationDetail | undefined): string =>
  d?.kind === "partner" ? (d.company?.name ?? "") : "";

type Msgs = ReturnType<typeof useMessages>;
type Box = ReturnType<typeof useOutbox>;

/** Phần giữa: đang tải · trống · dòng tin. */
function ChatBody({
  d,
  msgs,
  box,
  myId,
  readAt,
  jump,
}: {
  d: ConversationDetail | undefined;
  msgs: Msgs;
  box: Box;
  myId: string;
  readAt: number | null;
  jump: ReturnType<typeof useJump>;
}) {
  const { t } = useTranslation();
  const doRevoke = useRevokeAction(d?.id ?? "");
  // CR-148 · avatar người gửi: thẻ người đọc THEO LÔ cho cả thành viên (≤ 50 ⇒ một lời gọi).
  const memberIds = useMemo(() => d?.members.map((m) => m.user_id) ?? [], [d?.members]);
  const cards = usePersonCards(memberIds);
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
      cardOf={(uid) => cards.get(uid)}
      readAt={readAt}
      seen={seenPeople(lastMineSeq(msgs.items, myId), d.members, myId).map((x) => ({
        name: x.name,
        src: cards.get(x.user_id)?.avatar,
      }))}
      hasOlder={msgs.hasNextPage}
      loadingOlder={msgs.isFetchingNextPage}
      onOlder={() => void msgs.fetchNextPage()}
      onRevoke={(s) => void doRevoke(s)}
      onRetry={box.retry}
      focus={jump.focus}
      hasNewer={jump.hasNewer}
      onNewer={() => void jump.loadNewer()}
    />
  );
}

/** Chân khung: ô soạn; cuộc `partner` chỉ đọc ⇒ câu giải thích thay ô soạn (CR-169). */
function ChatFooter({
  d,
  onSend,
  dropSink,
}: {
  d: ConversationDetail;
  onSend: Box["send"];
  dropSink: MutableRefObject<((files: File[]) => void) | null>;
}) {
  const { t } = useTranslation();
  if (d.kind === "partner" && d.read_only) return <ReadOnlyNotice d={d} />;
  return (
    <MessageComposer
      conversationId={d.id}
      onSend={onSend}
      dropSink={dropSink}
      lockedReason={composerLocked(d) ? t("contracts.messages.peerGone") : null}
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
  const jump = useJump(id, msgs.items);
  const dropSink = useRef<((files: File[]) => void) | null>(null);
  const drop = useFileDrop(dropSink);
  const dropping = drop.active;
  const last = msgs.items[msgs.items.length - 1]?.seq ?? null;
  useMarkRead(id, conv.data ? last : null, myId);
  const readAt = useOpenReadMark(id, conv.data, myId);

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
      className={cn(
        "relative flex h-full min-h-0 flex-col bg-panel",
        !compact && "border-l border-rule",
      )}
      {...drop.handlers}
    >
      <ChatTop id={id} jump={jump}>
        {(onFind, onAttach) => (
          <ChatHeader
            onFind={onFind}
            onAttach={onAttach}
            title={d ? convTitle(d) : ""}
            subtitle={partnerJob(d)}
            company={partnerCompany(d)}
            members={d?.kind === "group" ? d.member_count : null}
            onBack={onBack}
            backClass={backClass}
            compact={compact}
            onMembers={() => setSheet(true)}
          />
        )}
      </ChatTop>
      <ChatBody d={d} msgs={msgs} box={box} myId={myId} readAt={readAt} jump={jump} />
      {d && <ChatFooter d={d} onSend={box.send} dropSink={dropSink} />}
      {dropping && <DropOverlay label={t("contracts.messages.dropHere")} />}
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
