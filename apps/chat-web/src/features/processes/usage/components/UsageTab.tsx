// CHAT-AC-58 · AC-H34 · CHAT-AC-56 · P-a PF4: tab "Token" của `RunPage` (KPI + bảng giai đoạn; `summary` ⇒ chỉ tổng).
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { ApiError } from "~/lib/http";
import { useRunUsage } from "../api";
import { StageUsageTable } from "./StageUsageTable";
import { UsageKpis } from "./UsageKpis";

export type UsageTabProps = { runId: string };

export function UsageTab({ runId }: UsageTabProps) {
  const { t } = useTranslation();
  const q = useRunUsage(runId);
  if (q.isPending) return <Skeleton className="h-40 w-full" aria-busy="true" />;
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-body">
        <p>{t(notFound ? "process.common.error.notFound" : "process.common.error.load")}</p>
        {!notFound && (
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            {t("process.common.error.retry")}
          </Button>
        )}
      </div>
    );
  }
  const u = q.data;
  return (
    <div className="flex flex-col gap-4">
      <UsageKpis totals={u.totals} />
      {u.totals.calls === 0 ? (
        <p className="text-body text-muted-foreground">{t("process.usage.empty")}</p>
      ) : (
        <StageUsageTable usage={u} />
      )}
      {u.detail === "summary" && (
        <p className="text-caption text-muted-foreground">{t("process.usage.summary")}</p>
      )}
      <p className="text-caption text-muted-foreground">{t("process.usage.footnote")}</p>
    </div>
  );
}
