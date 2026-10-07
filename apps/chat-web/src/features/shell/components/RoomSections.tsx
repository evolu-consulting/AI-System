// HUB-FR-96, HUB-FR-100, HUB-FR-102 · mục "Tin nhắn & Nhóm" (DM + nhóm, chưa đọc, lọc theo ô tìm) + kết quả "Người".
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { RoomListItem } from "~/features/rooms/components/RoomListItem";
import { useRoomList, useUnreadTotal } from "~/features/rooms/hooks/use-room-list";
import { roomTitle } from "~/features/rooms/lib/room-logic";
import { useSession } from "~/lib/auth/use-session";
import { PeopleResults } from "./PeopleResults";

type Props = {
  /** Từ khoá đã debounce. */
  q: string;
  activeRoomId: string | null;
  onNavigate?: () => void;
};

const SKELETON_ROWS = ["a", "b", "c", "d"];

function Body({ q, activeRoomId, onNavigate }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const myId = useSession((s) => s.me?.id ?? "");
  const list = useRoomList();
  const term = q.trim().toLowerCase();
  const rooms = term
    ? list.items.filter((r) => roomTitle(r).toLowerCase().includes(term))
    : list.items;

  if (list.isPending) {
    return (
      <div className="flex flex-col gap-2 px-1" aria-busy="true">
        {SKELETON_ROWS.map((k) => (
          <Skeleton key={k} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (list.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 px-2.5 py-3 text-sm">
        <span>{t("rooms.list.error")}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
          {t("rooms.list.retry")}
        </Button>
      </div>
    );
  }
  if (rooms.length === 0) {
    return (
      <p className="px-2.5 py-3 text-sm text-muted-foreground">
        {term ? t("rooms.list.noMatch", { q: q.trim() }) : t("rooms.list.empty")}
      </p>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-0.5">
        {rooms.map((r) => (
          <RoomListItem
            key={r.id}
            room={r}
            myId={myId}
            active={r.id === activeRoomId}
            onOpen={(id) => {
              void router.navigate({ to: "/rooms/$id", params: { id } });
              onNavigate?.();
            }}
          />
        ))}
      </ul>
      {list.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t("rooms.list.more")}
        </Button>
      )}
    </>
  );
}

export function RoomSections(p: Props) {
  const { t } = useTranslation();
  const total = useUnreadTotal();
  return (
    <>
      <PeopleResults q={p.q} onNavigate={p.onNavigate} />
      <section aria-labelledby="rooms-section-h" className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 px-2 pt-2">
          <h3 id="rooms-section-h" className="text-xs font-semibold text-muted-foreground">
            {t("rooms.section")}
          </h3>
          {total > 0 && (
            <span
              data-testid="unread-total"
              title={t("rooms.unreadBadge", { count: total })}
              className="rounded-full bg-primary px-1.5 text-[11px] leading-4 font-semibold text-primary-foreground"
            >
              {total}
            </span>
          )}
        </div>
        <Body {...p} />
      </section>
    </>
  );
}
