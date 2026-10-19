// PK-FR-10 · TF4 · `/login?next=&tenant=`: đã có phiên → `/contracts` (plan-frontend §1).
import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "~/features/auth/pages/LoginPage";

export type LoginSearch = { next?: string; tenant?: string };

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

// Viết tay thay vì zod: validateSearch nằm trong bundle ban đầu.
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    next: str(search.next),
    tenant: str(search.tenant),
  }),
  beforeLoad: async () => (await import("~/features/auth/lib/guard")).redirectIfAuthed(),
  component: LoginPage,
});
