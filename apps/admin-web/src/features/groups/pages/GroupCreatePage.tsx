// ADM-FR-62 · M3-R01 · /groups/new: form tạo group; platform chọn tenant qua `?tenant=<mã>` (như danh sách).
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { useTenantOptions } from "@/features/tenants/api";
import { useSession } from "@/lib/auth/use-session";
import { resolveViewedTenant } from "@/lib/viewed-tenant";
import { GroupForm } from "../components/editor/GroupForm";

const route = getRouteApi("/_authed/groups/new");

export function GroupCreatePage() {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const search = route.useSearch();
  const options = useTenantOptions(me?.role === "platform_admin");
  const tn = resolveViewedTenant(me, search.tenant, options);
  if (!me) return null;
  if (tn.unknown) return <NotFoundState backTo="/groups" />;
  const needsTenant = tn.isPlatform && !tn.tenantId;
  return (
    <>
      <PageHeader title={t("groups.editor.titleNew")} />
      {needsTenant ? (
        <EmptyState message={t("groups.selectTenant")} />
      ) : (
        <GroupForm
          tenantId={tn.tenantId}
          tenantKey={tn.isPlatform ? (tn.tenantKey ?? undefined) : undefined}
        />
      )}
    </>
  );
}
