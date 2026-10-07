// HUB-FR-96 · `/rooms/:id?flow=<id>`: màn phòng (F4). `flow` được nhận nhưng bỏ qua ở X2a (plan-frontend §2).
import { createFileRoute } from "@tanstack/react-router";
import { RoomPage } from "~/features/rooms/pages/RoomPage";

export type RoomSearch = { flow?: string };

export const Route = createFileRoute("/_authed/rooms/$id")({
  validateSearch: (search: Record<string, unknown>): RoomSearch =>
    typeof search.flow === "string" && search.flow !== "" ? { flow: search.flow } : {},
  component: RoomPage,
});
