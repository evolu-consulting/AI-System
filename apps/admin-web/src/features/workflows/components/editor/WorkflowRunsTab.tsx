// dify-workflows · tab "Lịch sử chạy" của workflow (platform_admin): lọc tenant/trạng thái/ngày, bảng lượt chạy Dify, phân trang
// server. Nạp khi mở tab. Không hiện inputs/app-key; thông báo lỗi do Hub đã che secret.
import { DIFY_RUN_STATUSES } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pagination } from "@/components/shared/Pagination";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { TenantPicker } from "@/components/shared/TenantPicker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenantOptions } from "@/features/tenants/api";
import { loadError } from "@/lib/load-error";
import { RUNS_PAGE_SIZE, type RunsParams, useWorkflowRuns } from "../../hooks/use-workflow-queries";
import { WorkflowRunsTable } from "./WorkflowRunsTable";

const ALL = "all";

export function WorkflowRunsTab({ workflowId }: { workflowId: string }) {
  const { t } = useTranslation();
  const tenants = useTenantOptions(true);
  const [tenantKey, setTenantKey] = useState<string | null>(null);
  const [status, setStatus] = useState<RunsParams["status"]>(undefined);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const tenantId = tenants.data?.find((x) => x.key === tenantKey)?.id;
  const params: RunsParams = {
    tenant_id: tenantId,
    status,
    from: from || undefined,
    to: to || undefined,
    offset,
  };
  // Đổi bộ lọc luôn về trang đầu.
  const filter = (fn: () => void) => {
    fn();
    setOffset(0);
  };
  const runs = useWorkflowRuns(workflowId, params, tenantKey === null || !!tenantId);
  const err = loadError(runs.error);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TenantPicker
          tenants={tenants.data ?? []}
          value={tenantKey}
          onChange={(k) => filter(() => setTenantKey(k))}
          label={t("workflows.runs.tenant")}
          allLabel={t("workflows.runs.allTenants")}
        />
        <Select
          value={status ?? ALL}
          onValueChange={(v) =>
            filter(() => setStatus(v === ALL ? undefined : (v as RunsParams["status"])))
          }
        >
          <SelectTrigger aria-label={t("workflows.runs.col.status")} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("workflows.runs.allStatus")}</SelectItem>
            {DIFY_RUN_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`workflows.runs.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          aria-label={t("workflows.runs.from")}
          value={from}
          max={to || undefined}
          onChange={(e) => filter(() => setFrom(e.target.value))}
          className="w-40"
        />
        <Input
          type="date"
          aria-label={t("workflows.runs.to")}
          value={to}
          min={from || undefined}
          onChange={(e) => filter(() => setTo(e.target.value))}
          className="w-40"
        />
      </div>
      <WorkflowRunsTable
        rows={runs.data?.items}
        isLoading={runs.isPending}
        isFetching={runs.isFetching}
        error={err}
        onRetry={() => void runs.refetch()}
        empty={
          <EmptyState
            message={t(
              runs.data?.available === false
                ? "workflows.runs.unavailable"
                : "workflows.runs.empty",
            )}
          />
        }
      />
      <Pagination
        offset={offset}
        limit={RUNS_PAGE_SIZE}
        total={runs.data?.total ?? 0}
        onOffsetChange={setOffset}
      />
    </div>
  );
}
