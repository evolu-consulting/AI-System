// ADM-FR-67 · AC-H34 · P-a F5: tab "Token" của trang lượt chạy admin (KPI + bảng giai đoạn; admin xem `full` ⇒ mở rộng lượt gọi).
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUsageView } from "../../hooks/use-run-data";
import { useUsageLocale } from "../../hooks/use-usage-locale";
import { StageUsageTable } from "./StageUsageTable";
import { UsageKpis } from "./UsageKpis";

type Props = { runId: string; tenantId: string | undefined };

export function UsageTab({ runId, tenantId }: Props) {
  const { t } = useTranslation();
  const localeReady = useUsageLocale();
  const v = useUsageView(runId, tenantId);
  if (v.state === "loading" || !localeReady) {
    return <Skeleton className="h-40 w-full" aria-busy="true" />;
  }
  if (v.state !== "ok") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-body">
        <p>
          {t(
            v.state === "notFound" ? "process.common.error.notFound" : "process.common.error.load",
          )}
        </p>
        {v.state === "notFound" ? null : (
          <Button variant="outline" size="sm" onClick={v.refetch}>
            {t("process.common.error.retry")}
          </Button>
        )}
      </div>
    );
  }
  const u = v.data;
  return (
    <div className="flex flex-col gap-4">
      <UsageKpis totals={u.totals} />
      {u.totals.calls === 0 ? (
        <p className="text-body text-muted-foreground">{t("process.usage.empty")}</p>
      ) : (
        <StageUsageTable usage={u} />
      )}
      <p className="text-caption text-muted-foreground">{t("process.usage.footnote")}</p>
    </div>
  );
}
