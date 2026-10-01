// ADM-FR-60 · tab phụ của chi tiết tenant: Users (tóm tắt + link) và các tab "Chưa khả dụng" (Feature/Agent/Quota).
import type { TenantDetail } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function UnavailableTab({
  body,
}: {
  body: "tenants.tab.unavailableBody" | "tenants.agents.unavailable";
}) {
  const { t } = useTranslation();
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("common.unavailable")}</CardTitle>
        <CardDescription>{t(body)}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export function TenantUsersTab({ tenant }: { tenant: TenantDetail }) {
  const { t } = useTranslation();
  const { user_count, tenant_admin_count, locked_user_count } = tenant.stats;
  return (
    <Card className="max-w-xl">
      <CardContent className="space-y-4 pt-6">
        <p className="text-body">
          {t("tenants.users.summary", {
            users: user_count,
            admins: tenant_admin_count,
            locked: locked_user_count,
          })}
        </p>
        <Button variant="outline" asChild>
          <Link to="/users" search={{ tenant: tenant.key }}>
            {t("tenants.users.open")}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
