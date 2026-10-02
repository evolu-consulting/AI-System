// ADM-FR-36 · M3-R13 · tab "Quyền hiệu lực" (CHỈ ĐỌC): AccessExplainer dùng chung + link "Mở Kiểm tra quyền" (/access?tab=check&user=&tenant=).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AccessExplainer } from "@/components/shared/access/AccessExplainer";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserAccess } from "../../hooks/use-user-access";

type Props = { userId: string; username: string; tenantKey: string };

export function UserAccessTab({ userId, username, tenantKey }: Props) {
  const { t, i18n } = useTranslation();
  const access = useUserAccess(userId);
  if (access.loadError) return <ErrorState {...access.loadError} onRetry={access.retry} />;
  if (!access.data || access.isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-4">
      <Button variant="link" className="px-0" asChild>
        <Link to="/access" search={{ tab: "check", user: username, tenant: tenantKey }}>
          {t("users.access.openCheck")}
        </Link>
      </Button>
      <AccessExplainer data={access.data} lang={i18n.language} />
    </div>
  );
}
