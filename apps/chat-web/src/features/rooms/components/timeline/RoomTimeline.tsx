// HUB-FR-96, HUB-FR-100 · dòng thời gian (`role="log"` chính là khung cuộn): nhóm theo ngày, tin cũ tải khi chạm đỉnh, "Đã xem" dưới tin cuối của mình.
import type { RoomMember, RoomMessage } from "@ai/contracts/chat";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { groupByDay } from "../../lib/room-logic";
import { DayDivider } from "./DayDivider";
import { MessageItem } from "./MessageItem";
import { SeenMark } from "./SeenMark";

type Props = {
  messages: RoomMessage[];
  myId: string;
  group: boolean;
  /** Người khác đã đọc tới tin `seenMessageId` (tin cuối của mình). */
  seen: { messageId: string | null; readers: RoomMember[] };
  hasOlder: boolean;
  loadingOlder: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  contentRef: RefObject<HTMLDivElement>;
  onScroll(): void;
};

export function RoomTimeline(p: Props) {
  const { t } = useTranslation();
  return (
    <div
      ref={p.scrollRef}
      onScroll={p.onScroll}
      role="log"
      aria-label={t("rooms.log")}
      aria-live="polite"
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div
        ref={p.contentRef}
        className="mx-auto flex w-full max-w-[800px] flex-col px-4 py-4 sm:px-6"
      >
        {p.loadingOlder && <p className="py-2 text-center text-caption text-muted-foreground">…</p>}
        {!p.hasOlder && p.messages.length > 0 && (
          <p className="py-2 text-center text-caption text-muted-foreground">{t("rooms.start")}</p>
        )}
        {p.messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("rooms.empty")}</p>
        )}
        {groupByDay(p.messages).map((g) => (
          <section key={g.day}>
            <DayDivider day={g.day} />
            {g.items.map((m) => (
              <div key={m.id}>
                <MessageItem message={m} mine={m.sender.id === p.myId} group={p.group} />
                {m.id === p.seen.messageId && <SeenMark readers={p.seen.readers} group={p.group} />}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
