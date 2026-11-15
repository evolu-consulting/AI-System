// CR-169 · route /messages (`?c=<id hội thoại>&company=<id công ty|own>`): màn «Tin nhắn» dùng gói chung với Sổ Hợp Tác.
import { createFileRoute } from "@tanstack/react-router";
import { MessagesPage } from "~/features/messages/pages/MessagesPage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function MessagesRoute() {
  const { c, company } = Route.useSearch();
  return <MessagesPage conversationId={c ?? null} company={company} />;
}

export const Route = createFileRoute("/_authed/messages")({
  validateSearch: (s: Record<string, unknown>): { c?: string; company?: string } => ({
    ...(typeof s.c === "string" && UUID.test(s.c) ? { c: s.c } : {}),
    ...(typeof s.company === "string" && (UUID.test(s.company) || s.company === "own")
      ? { company: s.company }
      : {}),
  }),
  component: MessagesRoute,
});
