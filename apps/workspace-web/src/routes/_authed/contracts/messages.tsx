// CR-132 · W2 · route /contracts/messages (`?c=<id hội thoại>`): màn «Tin nhắn» toàn màn. Trang nạp lazy theo route.
import { createFileRoute } from "@tanstack/react-router";
import { MessagesPage } from "~/features/messages/pages/MessagesPage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function MessagesRoute() {
  const { c } = Route.useSearch();
  return <MessagesPage conversationId={c ?? null} />;
}

export const Route = createFileRoute("/_authed/contracts/messages")({
  validateSearch: (s: Record<string, unknown>): { c?: string } =>
    typeof s.c === "string" && UUID.test(s.c) ? { c: s.c } : {},
  component: MessagesRoute,
});
