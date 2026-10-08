// HUB-FR-101, HUB-FR-103 · X2b D9, D10, D13: nội dung khung thread của phòng — header C1, tin thread, composer cho MỌI
// thành viên (menu `@` theo quyền người gõ, không chặn vì quyền agent) + gợi ý ngữ cảnh `roomAgent.threadContextHint`.
import { CHAT_CONTENT_MAX, type RoomActiveRun, type RoomMessage } from "@ai/contracts/chat";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Composer } from "~/features/composer/components/Composer";
import { useDraftKey } from "~/features/composer/hooks/use-draft";
import type { FlowFrameSlot } from "~/features/flow-panel/components/FlowFrame";
import { FlowHeader } from "~/features/flow-panel/components/FlowHeader";
import { type RoomTurnActions, useRerunFromList } from "../../hooks/use-answer-run";
import { useMarkFlowRead } from "../../hooks/use-mark-flow-read";
import { useFlowMessages, useFlowSend } from "../../hooks/use-room-flow";
import { pendingRuns, waitingRunIds } from "../../lib/room-agent";
import { lastSeqOf } from "../../lib/room-logic";
import { RoomFlowMessages } from "./RoomFlowMessages";

export type RoomFlowProps = {
  roomId: string;
  flowId: string;
  myId: string;
  activeRuns: readonly RoomActiveRun[] | undefined;
  /** Run đang chạy thuộc thread này (đã tách khỏi timeline, D7). */
  pending: readonly RoomActiveRun[];
  turn: RoomTurnActions;
  onClose(): void;
  /** Flow lạ / khác phòng (404) → bỏ `?flow`. */
  onUnknown(): void;
};

/** Tiêu đề = tin người đầu thread (tin gọi agent); đếm = `flow.message_count` của khối gốc, chưa có → số tin đã tải. */
function headerOf(messages: readonly RoomMessage[], fallback: string) {
  const first = messages.find((m) => m.sender_type === "user");
  const root = messages.find((m) => m.flow);
  return {
    title: first?.content ?? fallback,
    count: root?.flow ? root.flow.message_count : messages.length,
  };
}

export function RoomFlowContent(p: RoomFlowProps & FlowFrameSlot) {
  const { t } = useTranslation();
  const msgs = useFlowMessages(p.roomId, p.flowId, p.onUnknown);
  const { messages } = msgs;
  const send = useFlowSend(p);
  const draftKey = useDraftKey(p.roomId, p.flowId);
  const waiting = useMemo(() => waitingRunIds(p.activeRuns), [p.activeRuns]);
  const pending = useMemo(() => pendingRuns(p.pending, messages), [p.pending, messages]);
  const onRerun = useRerunFromList(messages, p.turn.rerun);
  // CR-050: mở thread = đã xem (bỏ highlight comment trên khối gốc).
  useMarkFlowRead(p.roomId, p.flowId, msgs.isPending ? 0 : lastSeqOf([...messages]));
  const head = headerOf(messages, t("flow.panel"));
  const failed = msgs.isError && !msgs.unknown;
  return (
    <>
      <FlowHeader title={head.title} count={head.count} mobile={p.mobile} onClose={p.onClose} />
      {failed ? (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
          <span>{t("roomAgent.flowLoadError")}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void msgs.refetch()}>
            {t("roomAgent.flowRetry")}
          </Button>
        </div>
      ) : (
        <RoomFlowMessages
          messages={messages}
          myId={p.myId}
          loading={msgs.isPending}
          hasOlder={msgs.hasNextPage}
          loadOlder={() => {
            if (msgs.hasNextPage && !msgs.isFetchingNextPage) void msgs.fetchNextPage();
          }}
          pending={pending}
          waiting={waiting}
          onAnswer={p.turn.answer}
          onRerun={onRerun}
        />
      )}
      <div className="shrink-0 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Composer
          ref={p.composerRef}
          variant="flow"
          draftKey={draftKey}
          autoFocus={!p.mobile}
          menus="agents"
          attachments={false}
          maxChars={CHAT_CONTENT_MAX}
          menuTitle={t("menu.agentsYours")}
          hint={t("roomAgent.threadContextHint")}
          onSubmit={send}
        />
      </div>
    </>
  );
}
