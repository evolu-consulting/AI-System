// CHAT-AC-01, CHAT-AC-18 · `/c/new`: trang chào + composer (F7).
import { createFileRoute } from "@tanstack/react-router";
import { WelcomePage } from "~/features/thread/pages/WelcomePage";

// portal-home: `?q=` từ ô "Hỏi AI" ở trang chủ ⇒ điền sẵn vào ô nhập.
export const Route = createFileRoute("/_authed/c/new")({
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" && s.q.trim() !== "" ? s.q.slice(0, 2000) : undefined,
  }),
  component: WelcomePage,
});
