// ADM-FR-68 · CR-060 · P-b FS1: `/sources` — trang Nguồn tham chiếu. Cờ engine off ⇒ NotFound (trong trang). Chunk lười (autoCodeSplitting).
import { createFileRoute } from "@tanstack/react-router";
import { SourcesPage } from "@/features/sources/pages/SourcesPage";

export type SourceKindFilter = "git_remote" | "local_path" | "library";
export type SourcesSearch = {
  tenant?: string;
  kind?: SourceKindFilter;
  q?: string;
  drawer?: "new" | "edit" | "view";
  source?: string;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === v);

// Viết tay như secrets: bộ lọc + drawer nằm trên URL. KHÔNG có `path` trong URL (FS5).
export const Route = createFileRoute("/_authed/sources")({
  validateSearch: (s: Record<string, unknown>): SourcesSearch => ({
    tenant: str(s.tenant),
    kind: oneOf(s.kind, ["git_remote", "local_path", "library"]),
    q: str(s.q),
    drawer: oneOf(s.drawer, ["new", "edit", "view"]),
    source: str(s.source),
  }),
  component: SourcesPage,
});
