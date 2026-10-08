// HUB-FR-96, HUB-FR-100, HUB-FR-102 · CR-050: vùng "Tin nhắn & Nhóm" = 2 mục thu gọn được — "Nhóm" (phòng nhóm, `+` tạo
// nhóm) và "Users" (DM đã có + mọi người trong danh bạ; bấm người chưa nhắn = mở DM ngay, POST /rooms {kind:"dm"}).
import type { DirectoryUser } from "@ai/contracts/chat";
import { useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { usePersonSearch } from "~/features/directory/hooks/use-person-search";
import { RoomListItem } from "~/features/rooms/components/RoomListItem";
import { RoomRowMenu } from "~/features/rooms/components/RoomRowMenu";
import { useCreateRoom } from "~/features/rooms/hooks/use-room-actions";
import { useRoomList } from "~/features/rooms/hooks/use-room-list";
import { roomErrorKeyOf } from "~/features/rooms/lib/room-errors";
import { useSession } from "~/lib/auth/use-session";
import { initialsOf } from "../lib/conversation-path";
import { groupRows, peopleRows, unreadOf } from "../lib/sidebar-rows";
import { SidebarGroup } from "./SidebarGroup";

type Props = {
  /** Từ khoá đã debounce. */
  q: string;
  activeRoomId: string | null;
  onNavigate?: () => void;
  /** Mở hộp thoại "Tạo nhóm"; vắng thì nút `+` bị vô hiệu. */
  onNewGroup?: () => void;
};

const SKELETON_ROWS = ["a", "b", "c"];

function Loading() {
  return (
    <div className="flex flex-col gap-2 px-1" aria-busy="true">
      {SKELETON_ROWS.map((k) => (
        <Skeleton key={k} className="h-9 w-full" />
      ))}
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="px-2.5 py-2 text-sm text-muted-foreground">{children}</p>;
}

function PersonItem({
  user,
  pending,
  onOpen,
}: {
  user: DirectoryUser;
  pending: boolean;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <li>
      <button
        type="button"
        aria-label={t("directory.messageTo", { name: user.display_name })}
        disabled={pending}
        onClick={() => onOpen(user.id)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sidebar-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
        >
          {initialsOf(user.display_name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{user.display_name}</span>
          <span className="truncate text-xs text-muted-foreground">@{user.username}</span>
        </span>
      </button>
    </li>
  );
}

/** Thân mục "Nhóm": tải / rỗng / không khớp / danh sách (lỗi list hiện chung ở trên). */
function GroupsBody(p: { pending: boolean; failed: boolean; term: string; children: ReactNode[] }) {
  const { t } = useTranslation();
  if (p.pending) return <Loading />;
  if (p.children.length > 0) return <ul className="flex flex-col gap-0.5">{p.children}</ul>;
  if (p.failed) return null;
  return <Empty>{p.term ? t("rooms.list.noMatch", { q: p.term }) : t("rooms.groupsEmpty")}</Empty>;
}

/** Thân mục "Users": danh bạ lỗi/đang tải vẫn hiện các DM đã có. */
function PeopleBody(p: {
  pending: boolean;
  dir: { isPending: boolean; isError: boolean };
  term: string;
  children: ReactNode[];
}) {
  const { t } = useTranslation();
  if (p.pending) return <Loading />;
  const none = p.children.length === 0;
  return (
    <>
      {!none && <ul className="flex flex-col gap-0.5">{p.children}</ul>}
      {p.dir.isPending && none && <Loading />}
      {p.dir.isError && (
        <p role="alert" className="px-2.5 py-2 text-sm">
          {t("directory.error")}
        </p>
      )}
      {!p.dir.isPending && !p.dir.isError && none && (
        <Empty>{p.term ? t("directory.noMatch", { q: p.term }) : t("rooms.peopleEmpty")}</Empty>
      )}
    </>
  );
}

export function RoomSections({ q, activeRoomId, onNavigate, onNewGroup }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const myId = useSession((s) => s.me?.id ?? "");
  const list = useRoomList();
  const term = q.trim();
  const dir = usePersonSearch(term);
  const create = useCreateRoom();

  const goRoom = (id: string) => {
    void router.navigate({ to: "/rooms/$id", params: { id } });
    onNavigate?.();
  };
  const openDm = (userId: string) =>
    create.mutate(
      { kind: "dm", user_id: userId },
      {
        onSuccess: (room) => goRoom(room.id),
        onError: (err) => toast.error(t(roomErrorKeyOf(err))),
      },
    );

  const groups = groupRows(list.items, term);
  const people = peopleRows(list.items, dir.data?.items ?? [], myId, term);
  const dms = list.items.filter((r) => r.kind === "dm");
  const roomItem = (r: (typeof list.items)[number]) => (
    <RoomListItem
      key={r.id}
      room={r}
      myId={myId}
      active={r.id === activeRoomId}
      onOpen={goRoom}
      menu={<RoomRowMenu room={r} active={r.id === activeRoomId} />}
    />
  );

  return (
    <section aria-labelledby="rooms-section-h" className="flex flex-col gap-1">
      <h3 id="rooms-section-h" className="sr-only">
        {t("rooms.section")}
      </h3>
      {list.isError && (
        <div role="alert" className="flex flex-col items-start gap-2 px-2.5 py-3 text-sm">
          <span>{t("rooms.list.error")}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
            {t("rooms.list.retry")}
          </Button>
        </div>
      )}
      <SidebarGroup
        id="groups"
        title={t("rooms.groups")}
        unread={unreadOf(list.items.filter((r) => r.kind === "group"))}
        badgeTestId="unread-groups"
        action={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            aria-label={t("shell.newGroup")}
            title={t("shell.newGroup")}
            disabled={!onNewGroup}
            onClick={onNewGroup}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        }
      >
        <GroupsBody pending={list.isPending} failed={list.isError} term={term}>
          {groups.map(roomItem)}
        </GroupsBody>
      </SidebarGroup>
      <SidebarGroup
        id="people"
        title={t("rooms.people")}
        unread={unreadOf(dms)}
        badgeTestId="unread-dms"
      >
        <PeopleBody pending={list.isPending} dir={dir} term={term}>
          {people.map((row) =>
            row.kind === "dm" ? (
              roomItem(row.room)
            ) : (
              <PersonItem
                key={row.user.id}
                user={row.user}
                pending={create.isPending}
                onOpen={openDm}
              />
            ),
          )}
        </PeopleBody>
      </SidebarGroup>
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
    </section>
  );
}
