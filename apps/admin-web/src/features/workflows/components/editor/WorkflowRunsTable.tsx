// dify-workflows · bảng lượt chạy Dify: thời gian, tenant, người dùng, kích hoạt, trạng thái, thời lượng, token, lỗi, mã Dify
// (+ link "Xem chi tiết trong Dify" khi có DIFY_CONSOLE_URL). Mã Dify chỉ để đối chiếu, không chứa bí mật.
import type { DifyRun } from "@ai/contracts";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";

const TONE = { ok: "ok", failed: "warn", aborted: "off" } as const;

function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

type Props = {
  rows: DifyRun[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
};

export function WorkflowRunsTable({ rows, isLoading, isFetching, error, onRetry, empty }: Props) {
  const { t } = useTranslation();
  const columns = useMemo<Column<DifyRun>[]>(
    () => [
      {
        id: "time",
        header: t("workflows.runs.col.time"),
        cell: (r) => <time dateTime={r.at}>{new Date(r.at).toLocaleString()}</time>,
      },
      { id: "tenant", header: t("workflows.runs.col.tenant"), cell: (r) => r.tenant.name },
      { id: "user", header: t("workflows.runs.col.user"), cell: (r) => r.user?.name ?? "—" },
      {
        id: "trigger",
        header: t("workflows.runs.col.trigger"),
        cell: (r) => t(`workflows.runs.trigger.${r.trigger}`),
      },
      {
        id: "status",
        header: t("workflows.runs.col.status"),
        cell: (r) => (
          <StatusBadge tone={TONE[r.status]}>{t(`workflows.runs.status.${r.status}`)}</StatusBadge>
        ),
      },
      {
        id: "duration",
        header: t("workflows.runs.col.duration"),
        cell: (r) => duration(r.duration_ms),
      },
      {
        id: "tokens",
        header: t("workflows.runs.col.tokens"),
        cell: (r) => r.tokens.toLocaleString(),
      },
      {
        id: "error",
        header: t("workflows.runs.col.error"),
        className: "max-w-64",
        cell: (r) =>
          r.error_message ? (
            <span className="line-clamp-2 break-words text-caption" title={r.error_message}>
              {r.error_message}
            </span>
          ) : (
            "—"
          ),
      },
      {
        id: "ids",
        header: t("workflows.runs.col.ids"),
        cell: (r) => (
          <div className="space-y-0.5 font-mono text-caption text-muted-foreground">
            {r.dify_workflow_run_id ? (
              <p>
                {t("workflows.runs.run")}: {r.dify_workflow_run_id}
              </p>
            ) : null}
            {r.dify_conversation_id ? (
              <p>
                {t("workflows.runs.conversation")}: {r.dify_conversation_id}
              </p>
            ) : null}
            {r.dify_url ? (
              <a
                href={r.dify_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-sans text-foreground hover:underline"
              >
                {t("workflows.runs.openDify")}
                <ExternalLink aria-hidden className="size-3" />
              </a>
            ) : null}
          </div>
        ),
      },
    ],
    [t],
  );
  return (
    <DataTable
      caption={t("workflows.runs.title")}
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      empty={empty}
    />
  );
}
