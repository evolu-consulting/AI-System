// CR-112 · tab Tổng quan (COULD) + bước Xem lại của wizard · tóm tắt chỉ đọc: số người dùng, app đang bật, số vai, quota tháng (run/token).
import type { TenantDetail } from "@ai/contracts";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { QuotaBar } from "@/components/shared/quota/QuotaBar";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadError } from "@/lib/load-error";
import { useTr } from "@/lib/use-translate";
import { useTenantOverview } from "../../hooks/use-tenant-overview";

type Props = { tenant: Pick<TenantDetail, "id" | "user_count"> };

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-label font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">{children}</CardContent>
    </Card>
  );
}

export function TenantOverview({ tenant }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const o = useTenantOverview(tenant.id);
  const err = loadError(o.error);
  if (err) return <ErrorState message={err.message} code={err.code} onRetry={o.refetch} />;
  if (o.pending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  const q = o.quota;
  return (
    <section aria-label={t("tenants.overview.title")} className="space-y-3">
      <p className="text-caption text-muted-foreground">{t("tenants.overview.hint")}</p>
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("tenants.overview.users")}>
          <p className="text-h2 font-semibold" data-testid="ov-users">
            {tenant.user_count}
          </p>
        </Stat>
        <Stat label={t("tenants.overview.apps")}>
          <p className="text-h2 font-semibold" data-testid="ov-apps">
            {o.apps?.length ?? 0}
          </p>
          {o.apps && o.apps.length > 0 ? (
            <ul className="text-caption text-muted-foreground">
              {o.apps.map((a) => (
                <li key={a.app}>
                  {tr(`featmeta.app.${a.app}.name`)}
                  {a.level === "on" ? "" : ` · ${t(`tenants.features.level.${a.level}`)}`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-muted-foreground">{t("tenants.overview.appsNone")}</p>
          )}
        </Stat>
        <Stat label={t("tenants.overview.roles")}>
          <p className="text-h2 font-semibold" data-testid="ov-roles">
            {o.roleCount ?? 0}
          </p>
        </Stat>
        <Stat label={t("tenants.overview.quota", { month: monthLabel(o.month) })}>
          {q ? (
            <div className="space-y-2">
              <QuotaBar label="Run" kind="runs" used={q.used.runs} limit={q.max_runs} />
              <QuotaBar label="Token" kind="tokens" used={q.used.tokens} limit={q.max_tokens} />
            </div>
          ) : (
            <p className="text-caption text-muted-foreground">{t("tenants.overview.quotaNone")}</p>
          )}
        </Stat>
      </div>
    </section>
  );
}

const monthLabel = (month: string | undefined) => (month ?? "").split("-").reverse().join("/");
