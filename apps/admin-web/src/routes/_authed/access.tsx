import { createFileRoute } from "@tanstack/react-router";
import { AccessPage } from "@/features/access/pages/AccessPage";

export type AccessSearch = { tab?: "matrix" | "check"; tenant?: string; user?: string };

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

export const Route = createFileRoute("/_authed/access")({
  validateSearch: (s: Record<string, unknown>): AccessSearch => ({
    tab: s.tab === "check" ? "check" : s.tab === "matrix" ? "matrix" : undefined,
    tenant: str(s.tenant),
    user: str(s.user),
  }),
  component: AccessPage,
});
