// CHAT-AC-05, CHAT-AC-20 · `/c/:id?flow=<flow_id>`: trang hội thoại (F8); `flow` mở khung flow (F10).
import { createFileRoute } from "@tanstack/react-router";
import { ConversationPage } from "~/features/thread/pages/ConversationPage";

export type ConversationSearch = { flow?: string };

export const Route = createFileRoute("/_authed/c/$id")({
  validateSearch: (search: Record<string, unknown>): ConversationSearch =>
    typeof search.flow === "string" && search.flow !== "" ? { flow: search.flow } : {},
  component: ConversationPage,
});
