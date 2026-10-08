// HUB-FR-96 · `/rooms/:id?flow=<id>`: màn phòng (F4). `flow` mở khung thread (X2b D10).
import { createFileRoute } from "@tanstack/react-router";
import { RoomPage } from "~/features/rooms/pages/RoomPage";

export type RoomSearch = { flow?: string };

export const Route = createFileRoute("/_authed/rooms/$id")({
  validateSearch: (search: Record<string, unknown>): RoomSearch =>
    typeof search.flow === "string" && search.flow !== "" ? { flow: search.flow } : {},
  component: RoomPage,
});
