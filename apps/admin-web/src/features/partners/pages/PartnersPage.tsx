// ADM-FR-74 · /partners: Tenant (platform), ô tìm, bảng công ty phân trang server, `+ Thêm công ty đối tác`, drawer tài khoản (`?org=`).
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/use-session";
import { PARTNERS_PAGE_SIZE } from "../api";
import { PartnerDrawer } from "../components/PartnerDrawer";
import { PartnerFilters } from "../components/PartnerFilters";
import { PartnersEmpty } from "../components/PartnersEmpty";
import { PartnerTable } from "../components/PartnerTable";
import { useOrgActions } from "../hooks/use-org-actions";
import { usePartnersNav } from "../hooks/use-partners-nav";
import { usePartnersView } from "../hooks/use-partners-view";

export function PartnersPage() {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const view = usePartnersView(me);
  const patch = usePartnersNav();
  const actions = useOrgActions(view.tenantId);
  const { list, tenantKey, page } = view;

  if (!me) return null;
  if (view.unknown) return <NotFoundState backTo="/partners" />;

  const create = (
    <Button disabled={!view.canCreate} onClick={actions.openCreate}>
      {t("partners.create")}
    </Button>
  );
  const openOrg = (org: { id: string }) => patch({ org: org.id }, true);

  return (
    <>
      <PageHeader
        title={t("partners.title")}
        description={t("partners.subtitle", { tenant: tenantKey ?? t("common.tenantPicker.all") })}
        actions={create}
      />
      <PartnerFilters
        tenants={view.isPlatform ? (view.tenants ?? []) : undefined}
        tenantKey={tenantKey}
        q={view.search.q ?? ""}
        onTenant={(key) => patch({ tenant: key ?? undefined, org: undefined })}
        onQuery={(q) => patch({ q: q || undefined })}
      />
      <PartnerTable
        orgs={view.needsTenant ? [] : list.data?.items}
        isLoading={!view.needsTenant && list.isPending && view.ready}
        isFetching={list.isFetching}
        error={view.loadError}
        onRetry={() => void list.refetch()}
        empty={
          <PartnersEmpty
            needsTenant={view.needsTenant}
            filtered={view.filtered}
            q={view.search.q}
            createAction={view.canCreate ? create : undefined}
            onClear={() => patch({ q: undefined })}
          />
        }
        onOpen={openOrg}
        onRename={actions.rename}
        onDeactivate={actions.deactivate}
        onReactivate={actions.reactivate}
      />
      <div className="mt-4">
        <Pagination
          offset={(page - 1) * PARTNERS_PAGE_SIZE}
          limit={PARTNERS_PAGE_SIZE}
          total={list.data?.total ?? 0}
          onOffsetChange={(o) => patch({ page: o / PARTNERS_PAGE_SIZE + 1, org: undefined }, true)}
        />
      </div>
      {view.search.org ? (
        <PartnerDrawer
          orgId={view.search.org}
          tenantKey={tenantKey ?? me.tenant.key}
          onClose={() => patch({ org: undefined }, true)}
        />
      ) : null}
      {actions.dialogs}
    </>
  );
}
