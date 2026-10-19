// HUB-FR-96 · `/rooms/:id?flow=<id>`: màn phòng (F4). `flow` mở khung thread (X2b D10).
import { createFileRoute, redirect } from "@tanstack/react-router";
import { RoomPage } from "~/features/rooms/pages/RoomPage";
import { frozenModulesOn } from "~/lib/frozen";

export type RoomSearch = { flow?: string };

export const Route = createFileRoute("/_authed/rooms/$id")({
  // F1 (CR-095): phòng đóng băng — cờ off ⇒ về hội thoại mới.
  beforeLoad: () => {
    if (!frozenModulesOn) throw redirect({ to: "/c/new" });
  },
  validateSearch: (search: Record<string, unknown>): RoomSearch =>
    typeof search.flow === "string" && search.flow !== "" ? { flow: search.flow } : {},
  component: RoomPage,
});
