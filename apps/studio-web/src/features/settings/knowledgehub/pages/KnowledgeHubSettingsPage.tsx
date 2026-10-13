// HUB-FR-131 · HUB-FR-132 · CR-073 · màn Studio → Cài đặt → "Kết nối KnowledgeHub" (mockup 1, plan-frontend K1 §2).
import type { KhConnection } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "#/components/shared/EmptyState";
import { ErrorState } from "#/components/shared/ErrorState";
import { PageHeader } from "#/components/shared/PageHeader";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { KhCheckDialog } from "../components/KhCheckDialog";
import { KhConnectionSheet, type KhSheetTarget } from "../components/KhConnectionSheet";
import { KhConnectionsTable } from "../components/KhConnectionsTable";
import { KhDeleteDialog } from "../components/KhDeleteDialog";
import { useKhCheck } from "../hooks/use-kh-check";
import { useKhConnections } from "../hooks/use-kh-connections";

const codeOf = (e: unknown) => (e as { code?: unknown } | null)?.code;

function Loading() {
  return (
    <div aria-busy="true" className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function Origins({ origins }: { origins: string[] }) {
  const { t } = useTranslation();
  if (origins.length === 0) return <Alert>{t("knowledgehub.noOrigins")}</Alert>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-label text-muted-foreground">
      <span id="kh-origins">{t("knowledgehub.origins")}</span>
      <ul aria-labelledby="kh-origins" className="flex flex-wrap gap-1.5">
        {origins.map((o) => (
          <li key={o} className="rounded-full bg-muted px-2 py-0.5 font-mono text-micro">
            {o}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function KnowledgeHubSettingsPage() {
  const { t } = useTranslation();
  const q = useKhConnections();
  const check = useKhCheck();
  const [sheet, setSheet] = useState<KhSheetTarget | null>(null);
  const [toDelete, setToDelete] = useState<KhConnection | null>(null);
  const add = <Button onClick={() => setSheet({ kind: "create" })}>{t("knowledgehub.add")}</Button>;
  const running = check.state?.phase === "running";

  let body = null;
  if (q.error) {
    body =
      codeOf(q.error) === "FORBIDDEN" ? (
        <EmptyState message={t("knowledgehub.forbidden")} />
      ) : (
        <ErrorState code={String(codeOf(q.error) ?? "") || undefined} onRetry={() => q.refetch()} />
      );
  } else if (q.isPending) {
    body = <Loading />;
  } else if (q.items.length === 0) {
    body = <EmptyState message={t("knowledgehub.empty")} action={add} />;
  } else {
    body = (
      <KhConnectionsTable
        items={q.items}
        checking={running}
        onCheck={(c) => void check.start(c)}
        onEdit={(c) => setSheet({ kind: "edit", item: c })}
        onDelete={setToDelete}
      />
    );
  }

  return (
    <>
      <PageHeader title={t("knowledgehub.title")} />
      <section aria-labelledby="kh-section" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="kh-section" className="text-card-title font-semibold">
            {t("knowledgehub.section")}
          </h2>
          {q.items.length > 0 ? add : null}
        </div>
        <p role="note" className="text-label text-muted-foreground">
          {t("knowledgehub.risk")}
        </p>
        {q.isPending || q.error ? null : <Origins origins={q.origins} />}
        {body}
        {q.hasNextPage ? (
          <div className="flex justify-center">
            <Button
              variant="outline"
              disabled={q.isFetchingNextPage}
              onClick={() => q.fetchNextPage()}
            >
              {t("knowledgehub.loadMore")}
            </Button>
          </div>
        ) : null}
      </section>
      <KhConnectionSheet target={sheet} onClose={() => setSheet(null)} />
      <KhDeleteDialog target={toDelete} onClose={() => setToDelete(null)} />
      <KhCheckDialog state={check.state} onClose={check.close} />
    </>
  );
}
