// ADM-FR-65 · CR-056 · P-a: `/processes` — danh sách quy trình (PF4). Cờ off ⇒ NotFound (trong trang).
import { createFileRoute } from "@tanstack/react-router";
import { ProcessesPage } from "@/features/processes/pages/ProcessesPage";

/** `app` (CR-118): lọc thư viện theo app (tiền tố khe `<app>.`), link từ trang cấu hình app. */
export type ProcessesSearch = { tab?: "own" | "templates"; app?: string };

export const Route = createFileRoute("/_authed/processes/")({
  validateSearch: (s: Record<string, unknown>): ProcessesSearch => ({
    tab: s.tab === "templates" ? "templates" : s.tab === "own" ? "own" : undefined,
    app: typeof s.app === "string" && /^[a-z0-9-]{2,32}$/.test(s.app) ? s.app : undefined,
  }),
  component: ProcessesPage,
});
