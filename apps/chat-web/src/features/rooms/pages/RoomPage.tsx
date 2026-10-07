// HUB-FR-96 · khung tạm của màn phòng (F3): chỉ tiêu đề; F4 thay bằng header + dòng thời gian + composer.
import { getRouteApi } from "@tanstack/react-router";
import { useRoom } from "../hooks/use-room";
import { roomTitle } from "../lib/room-logic";

const route = getRouteApi("/_authed/rooms/$id");

export function RoomPage() {
  const { id } = route.useParams();
  const { data } = useRoom(id);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-[60px] shrink-0 items-center border-b border-border px-4">
        <h1 className="truncate text-base font-semibold">{data ? roomTitle(data) : ""}</h1>
      </header>
    </div>
  );
}
