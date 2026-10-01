import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { redirectIfAuthed } from "@/features/shell/lib/guard";

export type LoginSearch = { tenant?: string; next?: string };

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

// Viết tay thay vì zod: validateSearch nằm trong bundle ban đầu (zod ≈ 20 KB gzip).
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    tenant: str(search.tenant),
    next: str(search.next),
  }),
  beforeLoad: () => redirectIfAuthed(),
  component: LoginPage,
});
