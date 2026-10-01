// ADM-FR-60 · Tổng quan tạm của M1: chào, hai lối tắt (Tenants nếu platform, Users). Không có KPI (C2).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/lib/auth/use-session";
import { navGroups } from "../lib/nav";

export function HomePage() {
  const { t } = useTranslation();
  const name = useSession((s) => s.me?.display_name ?? "");
  const role = useSession((s) => s.me?.role);
  const tenantName = useSession((s) => s.me?.tenant.name ?? "");
  const links = navGroups(role)
    .flatMap((g) => g.items)
    .filter((i) => i.id !== "overview");
  return (
    <>
      <PageHeader title={t("nav.overview")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("overview.welcome", { name })}</CardTitle>
          <CardDescription>
            {role === "platform_admin"
              ? t("overview.platform.body")
              : t("overview.tenant.body", { tenant: tenantName })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="flex flex-wrap gap-3">
            {links.map((item) => (
              <li key={item.id}>
                <Link
                  to={item.to}
                  className="inline-flex h-9 items-center rounded-md border border-border px-4 text-label font-medium text-primary hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {t(item.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-body text-muted-foreground">{t("overview.soon")}</p>
        </CardContent>
      </Card>
    </>
  );
}
