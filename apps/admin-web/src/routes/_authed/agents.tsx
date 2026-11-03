import { createFileRoute } from "@tanstack/react-router";
import { AgentsPage } from "@/features/agents/pages/AgentsPage";
import { redirectLegacy } from "@/features/shell/lib/legacy-route";
import { session } from "@/lib/auth/session";

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

// CR-054 · `?tenant=<mã>` (chỉ platform_admin). CR-112: tenant_admin không có nhóm Nền tảng — Agents nằm trong workspace công ty mình.
export const Route = createFileRoute("/_authed/agents")({
  validateSearch: (s: Record<string, unknown>): { tenant?: string } => ({ tenant: str(s.tenant) }),
  beforeLoad: ({ search }) => {
    if (session.getState().me?.role === "tenant_admin") return redirectLegacy("agents", search);
  },
  component: AgentsPage,
});
