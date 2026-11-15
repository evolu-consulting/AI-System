// CR-132 · W2 · route /contracts/messages (`?c=<id hội thoại>&company=<id công ty>`): màn «Tin nhắn» toàn màn. Trang nạp lazy theo route.
import { createFileRoute } from "@tanstack/react-router";
import { MessagesPage } from "~/features/messages/pages/MessagesPage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function MessagesRoute() {
  const { c, company } = Route.useSearch();
  return <MessagesPage conversationId={c ?? null} company={company} />;
}

export const Route = createFileRoute("/_authed/contracts/messages")({
  // CR-169 · `company` = id công ty đã kết nối (nút «Nhắn tin» ở trang đối tác) hoặc `all`/`own`: mở sẵn bộ lọc công ty.
  validateSearch: (s: Record<string, unknown>): { c?: string; company?: string } => ({
    ...(typeof s.c === "string" && UUID.test(s.c) ? { c: s.c } : {}),
    ...(typeof s.company === "string" &&
    (UUID.test(s.company) || s.company === "own" || s.company === "all")
      ? { company: s.company }
      : {}),
  }),
  component: MessagesRoute,
});
