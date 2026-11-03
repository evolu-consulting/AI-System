// CR-112 · ADM-FR-77 AC4 / Q11 · tab "Chi phí & quota" rút gọn của tenant_admin: chỉ đọc, dùng tháng này so với giới hạn (run/token),
// không tiền. Chỉ gọi GET /admin/tenants/:id/quotas (route cho tenant_admin công ty mình) — không đụng route chỉ-platform (daily-limits, grants/matrix).
import { useTranslation } from "react-i18next";
import { QuotaBar } from "@/components/shared/quota/QuotaBar";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadError } from "@/lib/load-error";
import { pickLocalized } from "@/lib/localized";
import { useTenantQuotas } from "../../api";
import { quotaLines } from "../../lib/overview";

const monthLabel = (month: string) => month.split("-").reverse().join("/");

export function TenantQuotaReadonly({ tenantId }: { tenantId: string }) {
  const { t, i18n } = useTranslation();
  const q = useTenantQuotas(tenantId, true);
  const err = loadError(q.error);
  if (err)
    return <ErrorState message={err.message} code={err.code} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-24 w-full" aria-busy="true" />;
  const lines = quotaLines(q.data.items);
  return (
    <section aria-label={t("tenants.quotaRo.title")} className="space-y-4">
      <div>
        <h2 className="text-h3 font-semibold">
          {t("tenants.quota.title", { month: monthLabel(q.data.month) })}
        </h2>
        <p className="text-caption text-muted-foreground">{t("tenants.quotaRo.hint")}</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("tenants.quota.col.scope")}</TableHead>
            <TableHead>{t("tenants.quota.col.used")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => {
            const scope = l.featureName
              ? pickLocalized(l.featureName, i18n.language)
              : t("tenants.quota.scope.tenant");
            return (
              <TableRow key={l.key} className="align-top">
                <TableCell className="font-medium">{scope}</TableCell>
                <TableCell className="min-w-64 space-y-2">
                  <QuotaBar
                    label={`Run · ${scope}`}
                    kind="runs"
                    used={l.runs.used}
                    limit={l.runs.limit}
                  />
                  <QuotaBar
                    label={`Token · ${scope}`}
                    kind="tokens"
                    used={l.tokens.used}
                    limit={l.tokens.limit}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-caption text-muted-foreground">{t("tenants.quotaRo.note")}</p>
    </section>
  );
}
