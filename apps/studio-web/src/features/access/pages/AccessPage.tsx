// HUB-FR-77 · HUB-FR-78 · HUB-BR-17 · màn Quyền agent (ui-agent-studio §9, artboard `Access.dc.html`, plan-frontend H4b2 D9–D11):
// ma trận switch agent × tenant. Bật = cấp ngay (không xác nhận); tắt = alertdialog nêu "{n} grant" rồi thu hồi.
import type { EntitlementMatrix } from "@ai/contracts/studio";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "#/components/shared/EmptyState";
import { ErrorState } from "#/components/shared/ErrorState";
import { PageHeader } from "#/components/shared/PageHeader";
import { Skeleton } from "#/components/ui/skeleton";
import { matrixQuery } from "../api";
import type { CellView } from "../components/AccessCell";
import { AccessFilters } from "../components/AccessFilters";
import { AccessMatrix } from "../components/AccessMatrix";
import { CellDrawer } from "../components/CellDrawer";
import { RevokeDialog, type RevokeTarget } from "../components/RevokeDialog";
import { type CellTarget, useAccessMutations } from "../hooks/use-access-mutations";
import { filterMatrix, indexCells } from "../lib/matrix";

const apiCode = (e: unknown) => (e as { code?: unknown } | null)?.code;
const toTarget = (v: CellView): CellTarget => ({
  agentId: v.agentId,
  tenantId: v.tenantId,
  agentKey: v.agentKey,
  tenantKey: v.tenantKey,
});

function Loading() {
  return (
    <div aria-busy="true" className="grid grid-cols-4 gap-2">
      {Array.from({ length: 12 }, (_, i) => `sk-${i}`).map((k) => (
        <Skeleton key={k} className="h-11 w-full" />
      ))}
    </div>
  );
}

function Loaded({ data }: { data: EntitlementMatrix }) {
  const { t } = useTranslation();
  const { grant, revoke } = useAccessMutations();
  const [agentId, setAgentId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [drawer, setDrawer] = useState<CellTarget | null>(null);
  const [toRevoke, setToRevoke] = useState<RevokeTarget | null>(null);
  const cells = useMemo(() => indexCells(data.cells), [data.cells]);
  const onToggle = useCallback(
    (v: CellView, next: boolean) =>
      next ? void grant(toTarget(v)) : setToRevoke({ ...toTarget(v), count: v.count }),
    [grant],
  );
  const onOpen = useCallback((v: CellView) => setDrawer(toTarget(v)), []);
  const view = filterMatrix(data, agentId, tenantId);
  return (
    <>
      <AccessFilters
        agents={data.agents}
        tenants={data.tenants}
        agentId={agentId}
        tenantId={tenantId}
        onAgent={setAgentId}
        onTenant={setTenantId}
      />
      {data.truncated ? (
        <p className="mb-2 text-label text-muted-foreground">{t("access.truncated")}</p>
      ) : null}
      <div className="rounded-lg border border-border bg-card">
        <AccessMatrix
          agents={view.agents}
          tenants={view.tenants}
          allTenants={data.tenants}
          cells={cells}
          onToggle={onToggle}
          onOpen={onOpen}
        />
      </div>
      <CellDrawer target={drawer} onClose={() => setDrawer(null)} />
      <RevokeDialog
        value={toRevoke}
        onClose={() => setToRevoke(null)}
        onConfirm={(v) => void revoke(v)}
      />
    </>
  );
}

function Content() {
  const { t } = useTranslation();
  const q = useQuery(matrixQuery);
  if (q.error) {
    return apiCode(q.error) === "FORBIDDEN" ? (
      <EmptyState message={t("access.forbidden")} />
    ) : (
      <ErrorState code={String(apiCode(q.error) ?? "") || undefined} onRetry={() => q.refetch()} />
    );
  }
  if (!q.data) return <Loading />;
  if (q.data.agents.length === 0) return <EmptyState message={t("access.empty")} />;
  return <Loaded data={q.data} />;
}

export function AccessPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("access.title")} subtitle={t("access.subtitle")} />
      <Content />
    </>
  );
}
