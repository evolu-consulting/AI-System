// ADM-FR-67 · CR-056 · P-a F5: tab "Lượt chạy" của editor — `GET /process-runs?scope=tenant&process_key=` (lọc server).

import type { ProcessRunSummary } from "@ai/contracts/hub-admin";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { formatClock } from "@/lib/format";
import { useTenantRuns } from "../../hooks/use-run-data";
import { RunStatusBadge } from "../run/RunStatusBadge";

type Props = { processKey: string; tenantId: string | undefined };

export function EditorRunsTab({ processKey, tenantId }: Props) {
  const { t } = useTranslation();
  const q = useTenantRuns(processKey, tenantId);
  const L = (k: string) => t(`process.admin.editor.runs.col.${k}`);
  const columns: Column<ProcessRunSummary>[] = [
    {
      id: "run",
      header: L("run"),
      cell: (r) => (
        <Link
          to="/processes/$processId/runs/$runId"
          params={{ processId: r.process.key, runId: r.id }}
          className="font-mono text-label text-primary underline-offset-4 hover:underline"
        >
          #{r.id.slice(0, 8)}
        </Link>
      ),
    },
    { id: "starter", header: L("starter"), cell: (r) => r.started_by.display_name },
    { id: "status", header: L("status"), cell: (r) => <RunStatusBadge status={r.status} /> },
    {
      id: "stage",
      header: L("stage"),
      cell: (r) => `${r.current_stage_idx + 1}/${r.stage_count}`,
    },
    { id: "started", header: L("started"), cell: (r) => formatClock(r.started_at) },
  ];
  const err = q.error;
  return (
    <DataTable
      caption={t("process.admin.editor.tab.runs")}
      columns={columns}
      rows={q.data?.items}
      getRowKey={(r) => r.id}
      isLoading={q.isPending}
      error={err ? { message: err.message, code: "code" in err ? String(err.code) : "" } : null}
      onRetry={() => void q.refetch()}
      empty={<EmptyState message={t("process.admin.editor.runs.empty")} />}
    />
  );
}
