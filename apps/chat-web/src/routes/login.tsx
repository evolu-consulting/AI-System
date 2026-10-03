// CHAT-AC-01, CHAT-AC-02 · `/login?next=`: đã đăng nhập → `/c/new`.
import { createFileRoute } from "@tanstack/react-router";
import { redirectIfAuthed } from "~/features/auth/lib/guard";
import { LoginPage } from "~/features/auth/pages/LoginPage";

export type LoginSearch = { next?: string };

// Viết tay thay vì zod: validateSearch nằm trong bundle ban đầu.
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    next: typeof search.next === "string" && search.next !== "" ? search.next : undefined,
  }),
  beforeLoad: () => redirectIfAuthed(),
  component: LoginPage,
});
