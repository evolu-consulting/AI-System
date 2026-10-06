// Đăng nhập Studio (+ bước TOTP) — công khai; đã có phiên → `next` hoặc /agents (plan-frontend §2).
import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "#/features/auth/pages/LoginPage";
import { redirectIfAuthed } from "#/features/shell/lib/guard";

export type LoginSearch = { next?: string };

// Viết tay thay vì zod: validateSearch nằm trong bundle ban đầu.
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    next: typeof search.next === "string" && search.next !== "" ? search.next : undefined,
  }),
  beforeLoad: ({ search }) => redirectIfAuthed(search.next),
  component: LoginPage,
});
