// CR-121 c11 · MỘT hàng việc: Việc · Quy trình (+ chip bước) · Trạng thái (+ lý do) · Luật · Đổi/Gán. Bấm hàng mở ngăn chi tiết.
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import type { StepRow } from "@/features/apps/lib/flow-view";
import { StepChips } from "@/features/processes/components/StepChips";
import { type FlowJob, JOB_KEY, jobFallbackName } from "../lib/flow-rows";
import { AppOffNote } from "./AssignErrorNote";

export const GRID =
  "grid grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_minmax(0,1.3fr)_5rem_5rem] items-center gap-3";

export function useJobName() {
  const { t } = useTranslation();
  return (j: Pick<FlowJob, "slot">): string => {
    const k = JOB_KEY[j.slot];
    return k ? t(`tenants.flows.job.${k}`) : jobFallbackName(j.slot);
  };
}

function JobStatus({ job, tenantId }: { job: FlowJob; tenantId: string }) {
  const { t } = useTranslation();
  const on = job.status === "on";
  const label = job.appOff
    ? "tenants.flows.appOffStatus"
    : on
      ? "tenants.flows.on"
      : "tenants.flows.off";
  return (
    <span
      className="flex min-w-0 flex-wrap items-center gap-1"
      data-testid={`flows-status-${job.slot}`}
    >
      <StatusBadge tone={on ? "ok" : "off"}>{t(label)}</StatusBadge>
      {job.appOff ? (
        <AppOffNote tenantId={tenantId} app={job.app} />
      ) : job.reason ? (
        <span className="text-caption text-muted-foreground">
          {`· ${t(`tenants.flows.reason.${job.reason}`)}`}
        </span>
      ) : null}
    </span>
  );
}
export function JobRow({
  job,
  steps,
  canChange,
  tenantId,
  onOpen,
}: {
  tenantId: string;
  job: FlowJob;
  steps: readonly StepRow[] | null;
  canChange: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const name = useJobName()(job);
  return (
    <div
      className={`${GRID} border-t border-border px-3 py-2`}
      data-testid={`flows-job-${job.slot}`}
      data-status={job.status}
    >
      <button
        type="button"
        className="min-w-0 truncate text-left text-label font-medium hover:underline"
        title={name}
        onClick={onOpen}
        data-testid={`flows-open-${job.slot}`}
      >
        {name}
      </button>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-body" title={job.defName ?? undefined}>
          {job.defId ? (
            <>
              {job.defName}
              {steps ? (
                <span className="text-muted-foreground">{` · ${t("tenants.flows.steps", { n: steps.length })}`}</span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">{t("tenants.flows.noneChosen")}</span>
          )}
        </span>
        {job.source === "system" ? (
          <span
            className="text-caption text-muted-foreground"
            data-testid={`flows-system-default-${job.slot}`}
          >
            {t("tenants.flows.systemDefault")}
          </span>
        ) : null}
        <StepChips steps={steps} />
      </div>
      <JobStatus job={job} tenantId={tenantId} />
      <span className="text-body text-muted-foreground">
        {job.rules > 0 ? t("tenants.flows.rules", { n: job.rules }) : "—"}
      </span>
      <span className="text-right">
        {canChange && !job.appOff ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onOpen}
            data-testid={`flows-assign-${job.slot}`}
          >
            {t(job.defId ? "tenants.flows.change" : "tenants.flows.assign")}
          </Button>
        ) : null}
      </span>
    </div>
  );
}
