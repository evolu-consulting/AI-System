// CR-121 c11 · R4 · tab "Quy trình" của công ty — NƠI DUY NHẤT gán quy trình cho công ty (artboard CompanyFlows + Tpl-Detail).
// App → việc → quy trình đang gán (chip bước, Đang bật/tắt + lý do, số luật, Đổi/Gán). platform_admin + tenant_admin công ty mình.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { useSession } from "@/lib/auth/use-session";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useCompanyFlows } from "../hooks/use-company-flows";
import { FlowDrawer } from "./FlowDrawer";
import { GRID, JobRow } from "./JobRow";

export default function CompanyFlowsTab({
  tenant,
  initialJob,
}: {
  tenant: { id: string; name: string };
  /** Việc mở sẵn ngăn Gán (từ dải "Cần xử lý" ở tab Ứng dụng). */
  initialJob?: string;
}) {
  const { t } = useTranslation();
  const tr = useTr();
  const role = useSession((s) => s.me?.role);
  const isPlatform = role === "platform_admin";
  const f = useCompanyFlows(tenant.id);
  const [open, setOpen] = useState<string | null>(initialJob ?? null);
  if (f.pending) return <LoadingState />;
  if (f.error) {
    const e = f.error instanceof ApiError ? f.error : null;
    return (
      <ErrorState
        message={e?.message ?? ""}
        code={e?.code ?? "NETWORK_ERROR"}
        onRetry={f.refetch}
      />
    );
  }
  const job = f.groups.flatMap((g) => g.jobs).find((j) => j.slot === open) ?? null;
  return (
    <div className="space-y-4" data-testid="company-flows">
      <p className="text-body text-muted-foreground">
        {t("tenants.flows.lead")}
        <span className="ml-1 text-caption" title={t("tenants.flows.leadInfo")}>
          {`(${t("tenants.flows.leadInfo")})`}
        </span>
      </p>
      {f.summary.total > 0 ? (
        <p className="text-caption text-muted-foreground" data-testid="flows-summary">
          {t("tenants.flows.summary", f.summary)}
        </p>
      ) : null}
      {f.routingFailed ? (
        <p role="alert" className="text-caption text-destructive">
          {t("tenants.flows.loadFail")}
        </p>
      ) : null}
      {f.groups.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("tenants.flows.empty")}</p>
      ) : (
        <div className="rounded-md border border-border">
          <div
            className={`${GRID} px-3 py-2 text-caption font-semibold text-muted-foreground`}
            role="presentation"
          >
            <span>{t("tenants.flows.col.job")}</span>
            <span>{t("tenants.flows.col.process")}</span>
            <span>{t("tenants.flows.col.status")}</span>
            <span>{t("tenants.flows.col.rules")}</span>
            <span />
          </div>
          {f.groups.map((g) => (
            <section
              key={g.app}
              aria-label={tr(`featmeta.app.${g.app}.name`)}
              data-testid={`flows-app-${g.app}`}
            >
              <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-3 py-2">
                <h2 className="text-label font-semibold">{tr(`featmeta.app.${g.app}.name`)}</h2>
                <span className="rounded-full bg-muted px-2 text-caption text-muted-foreground">
                  {t("tenants.flows.appJobs", { n: g.jobs.length })}
                </span>
              </div>
              {g.jobs.map((j) => (
                <JobRow
                  key={j.slot}
                  job={j}
                  tenantId={tenant.id}
                  steps={f.stepsOf(j.slot)}
                  canChange
                  onOpen={() => setOpen(j.slot)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
      <FlowDrawer
        tenantId={tenant.id}
        job={job}
        isPlatform={isPlatform}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
