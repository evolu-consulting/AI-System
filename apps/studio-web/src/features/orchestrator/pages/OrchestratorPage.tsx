// HUB-FR-62 · H4a-R07..R09 · màn Orchestrator (canvas Orchestrator): form mặc định + bảng theo tenant + Sheet `?tenant=<id>|new`.

import type { Orchestrator } from "@ai/contracts/studio";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "#/components/shared/ConfirmDialog";
import { ErrorState } from "#/components/shared/ErrorState";
import { PageHeader } from "#/components/shared/PageHeader";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { DefaultForm } from "../components/DefaultForm";
import { type SheetTarget, TenantSheet } from "../components/TenantSheet";
import { TenantTable } from "../components/TenantTable";
import { useOrchData } from "../hooks/use-orch-data";
import { useOrchMutations } from "../hooks/use-orch-mutations";

const route = getRouteApi("/_authed/orchestrator");
const apiCode = (e: unknown) => (e as { code?: unknown } | null)?.code;

function Loading() {
  return (
    <div aria-busy="true" className="space-y-3">
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function OrchestratorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = route.useSearch();
  const { orch, tenants, options, locale } = useOrchData();
  const m = useOrchMutations();
  const [toDelete, setToDelete] = useState<Orchestrator | null>(null);

  const go = (tenant?: string) =>
    void navigate({ to: "/orchestrator", search: { tenant }, replace: true });
  const data = orch.data;
  const target: SheetTarget | null =
    search.tenant === "new"
      ? { kind: "new" }
      : (() => {
          const hit = data?.tenants.find((x) => x.tenant?.id === search.tenant);
          return hit ? { kind: "edit" as const, orch: hit } : null;
        })();

  return (
    <>
      <PageHeader title={t("orch.title")} subtitle={t("orch.subtitle")} />
      {orch.error ? (
        <ErrorState code={String(apiCode(orch.error) ?? "") || undefined} onRetry={orch.refetch} />
      ) : !data ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <DefaultForm value={data.default} options={options} save={m.save} reload={m.reload} />
          <section aria-labelledby="orch-tenants" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="orch-tenants" className="text-section-title font-semibold">
                {t("orch.tenants.title")}
              </h2>
              <Button variant="outline" onClick={() => go("new")}>
                {t("orch.tenants.add")}
              </Button>
            </div>
            <TenantTable
              def={data.default}
              tenants={data.tenants}
              locale={locale}
              onEdit={(o) => go(o.tenant?.id)}
              onDelete={setToDelete}
            />
          </section>
        </div>
      )}
      {data ? (
        <TenantSheet
          target={target}
          def={data.default}
          tenants={tenants.data ?? []}
          options={options}
          save={m.save}
          reload={m.reload}
          onClose={() => go(undefined)}
        />
      ) : null}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t("orch.delete.title", { tenant: toDelete?.tenant?.key ?? "" })}
        body={t("orch.delete.body")}
        confirmLabel={t("orch.delete.confirm")}
        destructive
        onConfirm={() => {
          const o = toDelete;
          if (o?.tenant)
            m.remove({ tenantId: o.tenant.id, version: o.version, name: o.tenant.key });
          setToDelete(null);
        }}
      />
    </>
  );
}
