// ADM-FR-65 · CR-056 · P-a: `/processes` — danh sách quy trình (PF4). Cờ off ⇒ NotFound (trong trang).
import { createFileRoute } from "@tanstack/react-router";
import { ProcessesPage } from "@/features/processes/pages/ProcessesPage";

export type ProcessesSearch = { tab?: "own" | "templates" };

export const Route = createFileRoute("/_authed/processes/")({
  validateSearch: (s: Record<string, unknown>): ProcessesSearch => ({
    tab: s.tab === "templates" ? "templates" : s.tab === "own" ? "own" : undefined,
  }),
  component: ProcessesPage,
});
