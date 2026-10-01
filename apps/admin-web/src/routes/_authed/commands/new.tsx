// ADM-FR-10 · M2 · stub route (FE1a): chỉ PageHeader trong PlatformOnly; màn thật thay ở FE6b.
// `validateSearch` có sẵn để Workflows ("Tạo command") và nhân bản điều hướng kèm `?workflow=` / `?from=`.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformOnly } from "@/components/shared/PlatformOnly";

export type CommandNewSearch = { from?: string; workflow?: string; tab?: "config" | "access" };

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

function Stub() {
  const { t } = useTranslation();
  return (
    <PlatformOnly>
      <PageHeader title={t("commands.editor.titleNew")} />
    </PlatformOnly>
  );
}

export const Route = createFileRoute("/_authed/commands/new")({
  validateSearch: (s: Record<string, unknown>): CommandNewSearch => ({
    from: str(s.from),
    workflow: str(s.workflow),
    tab: s.tab === "config" || s.tab === "access" ? s.tab : undefined,
  }),
  component: Stub,
});
