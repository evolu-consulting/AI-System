// ADM-FR-65 · CR-056 · P-a: `/processes` — danh sách quy trình (PF4). Cờ off ⇒ NotFound (trong trang).
import { createFileRoute } from "@tanstack/react-router";
import { type LibFilter, parseLibFilter } from "@/features/processes/lib/library-filter";
import { ProcessesPage } from "@/features/processes/pages/ProcessesPage";

/** `app` (CR-118) + `slot`/`status`/`tenant` (CR-120): bộ lọc thư viện (nút phễu), lưu ở URL; link từ trang cấu hình app dùng `app`. */
export type ProcessesSearch = { tab?: "own" | "templates" } & LibFilter;

export const Route = createFileRoute("/_authed/processes/")({
  validateSearch: (s: Record<string, unknown>): ProcessesSearch => ({
    tab: s.tab === "templates" ? "templates" : s.tab === "own" ? "own" : undefined,
    ...parseLibFilter(s),
  }),
  component: ProcessesPage,
});
