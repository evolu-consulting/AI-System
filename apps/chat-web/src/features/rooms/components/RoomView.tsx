// HUB-FR-96, HUB-FR-100 · ghép màn phòng: header + dòng thời gian + composer; 404 → RoomNotFound.
import type { RoomMessage } from "@ai/contracts/chat";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useSession } from "~/lib/auth/use-session";
import { useRoomTurnActions } from "../hooks/use-answer-run";
import { useMarkRead } from "../hooks/use-mark-read";
import { useRoom, useRoomMessages } from "../hooks/use-room";
import { useRoomExit } from "../hooks/use-room-actions";
import { useRoomLost } from "../hooks/use-room-lost";
import { useRoomRuns } from "../hooks/use-room-runs";
import { useRoomScroll } from "../hooks/use-room-scroll";
import { lastIsOwnTurn, newFromOthers, waitingRunIds } from "../lib/room-agent";
import { isRoomNotFound } from "../lib/room-errors";
import { lastSeqOf, roomTitle, seenBy } from "../lib/room-logic";
import { roomToast } from "../lib/room-toast";
import { type RoomDialogKind, RoomDialogs } from "./dialogs/RoomDialogs";
import { RoomHeader } from "./header/RoomHeader";
import { RoomComposer } from "./RoomComposer";
import { RoomNotFound } from "./RoomNotFound";
import { NewMessagesPill } from "./timeline/NewMessagesPill";
import { RoomTimeline } from "./timeline/RoomTimeline";

const SKELETON_ROWS = ["a", "b", "c", "d", "e"];

function useHide(roomId: string) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const exit = useRoomExit(roomId, "hide");
  return {
    hiding: exit.isPending,
    hide: () =>
      exit.mutate(undefined, {
        onSuccess: () => {
          roomToast(t("rooms.toast.hidden"));
          void navigate({ to: "/c/new" });
        },
        onError: () => toast.error(t("rooms.toast.actionFailed")),
      }),
  };
}

export function RoomView({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const myId = useSession((s) => s.me?.id ?? "");
  const room = useRoom(roomId);
  const msgs = useRoomMessages(roomId);
  const { messages } = msgs;
  const lastSeq = lastSeqOf(messages);
  // R19: tin agent của lượt mình gửi cũng là "của mình" (không pill, đánh dấu đã đọc).
  const lastIsMine = lastIsOwnTurn(messages, myId);
  const pending = useRoomRuns(roomId, room.data?.active_runs, messages, myId);
  const navigate = useNavigate();
  const openFlow = useCallback(
    (flow: string) => void navigate({ to: "/rooms/$id", params: { id: roomId }, search: { flow } }),
    [navigate, roomId],
  );
  const activeRuns = room.data?.active_runs;
  const waiting = useMemo(() => waitingRunIds(activeRuns), [activeRuns]);
  const turn = useRoomTurnActions(roomId, openFlow);
  const { rerun } = turn;
  // Ref: giữ `onRerun` ổn định (AgentBlock memo) dù danh sách tin đổi.
  const msgRef = useRef(messages);
  msgRef.current = messages;
  const onRerun = useCallback(
    (m: RoomMessage) => {
      const trigger = msgRef.current.find((x) => x.id === m.trigger_message_id);
      if (trigger) void rerun(m, trigger.content);
    },
    [rerun],
  );
  const loading = room.isPending || msgs.isPending;
  const failed = !loading && (room.isError || msgs.isError);
  const scroll = useRoomScroll({
    ready: !loading && !failed,
    firstId: messages[0]?.id,
    lastSeq,
    loadOlder: () => void msgs.fetchNextPage(),
    canLoadOlder: msgs.hasOlder && !msgs.isFetchingNextPage,
    fetchingOlder: msgs.isFetchingNextPage,
  });
  useMarkRead({ roomId, lastSeq, atBottom: scroll.atBottom, lastIsMine });
  useRoomLost(roomId, room.data ? roomTitle(room.data) : "");
  const { hide, hiding } = useHide(roomId);
  const [dialog, setDialog] = useState<RoomDialogKind | null>(null);

  if (isRoomNotFound(room.error) || isRoomNotFound(msgs.error)) return <RoomNotFound />;
  const group = room.data?.kind === "group";
  const newCount = scroll.atBottom ? 0 : newFromOthers(messages, scroll.seenSeq, myId);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {/* Chỗ cho FlowPane ở X2b: thêm `open.flow && <FlowPane …>` cạnh cột chính. */}
      <div className="flex min-h-0 min-w-0 flex-[1_1_0] flex-col">
        <RoomHeader room={room.data} myId={myId} onHide={hide} hiding={hiding} onOpen={setDialog} />
        {room.data && <RoomDialogs room={room.data} myId={myId} kind={dialog} onKind={setDialog} />}
        {loading && (
          <div className="flex flex-1 flex-col gap-3 p-6" aria-busy="true">
            {SKELETON_ROWS.map((k) => (
              <Skeleton key={k} className="h-10 w-2/3" />
            ))}
          </div>
        )}
        {failed && (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
            <span>{t("rooms.loadError")}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void Promise.all([room.refetch(), msgs.refetch()])}
            >
              {t("rooms.retry")}
            </Button>
          </div>
        )}
        {room.data && !loading && !failed && (
          <>
            <div className="relative flex min-h-0 flex-1 flex-col">
              <RoomTimeline
                messages={messages}
                myId={myId}
                group={group}
                seen={seenBy(room.data, messages, myId)}
                hasOlder={msgs.hasOlder}
                loadingOlder={msgs.isFetchingNextPage}
                scrollRef={scroll.scrollRef}
                contentRef={scroll.contentRef}
                onScroll={scroll.onScroll}
                pending={pending}
                onReply={openFlow}
                waiting={waiting}
                onAnswer={turn.answer}
                onRerun={onRerun}
              />
              {newCount > 0 && <NewMessagesPill count={newCount} onClick={scroll.scrollToBottom} />}
            </div>
            <RoomComposer
              roomId={roomId}
              target={group ? "" : roomTitle(room.data)}
              group={group}
              onSent={scroll.scrollToBottom}
            />
          </>
        )}
      </div>
    </div>
  );
}
