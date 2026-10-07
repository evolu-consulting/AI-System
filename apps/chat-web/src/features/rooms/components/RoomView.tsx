// HUB-FR-96, HUB-FR-100 · ghép màn phòng: header + dòng thời gian + composer; 404 → RoomNotFound.
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useSession } from "~/lib/auth/use-session";
import { useMarkRead } from "../hooks/use-mark-read";
import { useRoom, useRoomMessages } from "../hooks/use-room";
import { useRoomExit } from "../hooks/use-room-actions";
import { useRoomLost } from "../hooks/use-room-lost";
import { useRoomScroll } from "../hooks/use-room-scroll";
import { isRoomNotFound } from "../lib/room-errors";
import { lastSeqOf, roomTitle, seenBy } from "../lib/room-logic";
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
          toast(t("rooms.toast.hidden"));
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
  const lastIsMine = messages[messages.length - 1]?.sender.id === myId;
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

  if (isRoomNotFound(room.error) || isRoomNotFound(msgs.error)) return <RoomNotFound />;
  const group = room.data?.kind === "group";
  const newCount = scroll.atBottom
    ? 0
    : messages.filter((m) => m.seq > scroll.seenSeq && m.sender.id !== myId).length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {/* Chỗ cho FlowPane ở X2b: thêm `open.flow && <FlowPane …>` cạnh cột chính. */}
      <div className="flex min-h-0 min-w-0 flex-[1_1_0] flex-col">
        <RoomHeader room={room.data} onHide={hide} hiding={hiding} />
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
