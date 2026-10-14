// ADM-FR-68 · PB-R21 · `/sources`: tiêu đề + lọc (Công ty [platform] · Loại nguồn · tìm ký hiệu) + bảng + drawer + xoá.
// Cờ engine off ⇒ NotFound; `member` ⇒ Forbidden (không gọi API). Drawer/bộ lọc nằm trên URL, không có `path`.
import type { SourceView } from "@ai/contracts/hub-admin";
import { lazy, Suspense, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { TenantPicker } from "@/components/shared/TenantPicker";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProcessRouteGate } from "@/features/processes/components/ProcessRouteGate";
import { useSession } from "@/lib/auth/use-session";
import { ApiError } from "@/lib/http";
import { SourcesEmpty } from "../components/SourcesEmpty";
import { type SourceAction, SourceTable } from "../components/SourceTable";
import { useSourceDelete } from "../hooks/use-source-delete";
import { type SourcesView, useSourcesView } from "../hooks/use-sources-view";
import { SOURCE_KINDS_UI } from "../lib/source-kinds";
import { SourceDrawerController } from "./SourceDrawerController";

const ALL = "all";
const CredentialSheet = lazy(() => import("../components/CredentialSheet"));

function Filters({ v }: { v: SourcesView }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {v.isPlatform ? (
        <TenantPicker
          tenants={v.tenants ?? []}
          value={v.tenantKey}
          onChange={(k) => v.nav.patch({ tenant: k ?? undefined })}
          label={t("process.sources.filter.tenant")}
          allLabel={t("process.sources.field.tenantPlaceholder")}
        />
      ) : null}
      <Select
        value={v.search.kind ?? ALL}
        onValueChange={(k) => v.nav.patch({ kind: k === ALL ? undefined : k })}
      >
        <SelectTrigger aria-label={t("process.sources.filter.kind")} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("process.sources.filter.kindAll")}</SelectItem>
          {SOURCE_KINDS_UI.map((k) => (
            <SelectItem key={k} value={k}>
              {t(`process.sources.kind.${k}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="ml-auto w-full sm:w-auto">
        <SearchBox
          label={t("process.sources.filter.search")}
          value={v.search.q ?? ""}
          onChange={(q) => v.nav.patch({ q: q || undefined })}
        />
      </div>
    </div>
  );
}

function SourcesContent() {
  const { t } = useTranslation();
  const v = useSourcesView();
  const del = useSourceDelete(v.tenantId);
  const [autoCheck, setAutoCheck] = useState<string | null>(null);
  const [credOpen, setCredOpen] = useState(false);
  const { nav, search } = v;
  const err = v.list.error instanceof ApiError ? v.list.error : null;
  const filtered = !!search.q || !!search.kind;

  const onAction = useCallback(
    (action: SourceAction, s: SourceView) => {
      if (action === "delete") void del.request(s);
      else {
        setAutoCheck(action === "check" ? s.key : null);
        nav.openDrawer(action === "view" ? "view" : "edit", s.key);
      }
    },
    [del.request, nav.openDrawer],
  );
  const create = (
    <Button disabled={v.needsTenant} onClick={() => nav.openDrawer("new")}>
      {t("process.sources.add")}
    </Button>
  );
  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="outline" disabled={v.needsTenant} onClick={() => setCredOpen(true)}>
        {t("process.sources.credential.manage")}
      </Button>
      {create}
    </div>
  );
  const clear = () => nav.patch({ q: undefined, kind: undefined });
  if (!v.me) return null;

  return (
    <>
      <PageHeader
        title={t("process.sources.title")}
        description={t("process.sources.subtitle")}
        actions={actions}
      />
      <Filters v={v} />
      {v.needsTenant ? (
        <EmptyState message={t("process.sources.needTenant")} />
      ) : (
        <>
          <SourceTable
            sources={v.rows}
            role={v.me.role}
            isLoading={v.list.isPending}
            isFetching={v.list.isFetching}
            error={
              err || v.list.isError
                ? { message: t("process.sources.loadError"), code: err?.code ?? "" }
                : null
            }
            onRetry={() => void v.list.refetch()}
            empty={
              <SourcesEmpty
                filtered={filtered}
                q={search.q}
                createAction={create}
                onClear={clear}
              />
            }
            onAction={onAction}
          />
          {v.list.hasNextPage ? (
            <Button
              variant="outline"
              className="mt-4"
              disabled={v.list.isFetchingNextPage}
              onClick={() => void v.list.fetchNextPage()}
            >
              {t("process.sources.more")}
            </Button>
          ) : null}
        </>
      )}
      {search.drawer ? (
        <SourceDrawerController
          key={`${search.drawer}-${search.source ?? ""}`}
          mode={search.drawer}
          sourceKey={search.source}
          tenantId={v.tenantId}
          tenantKey={v.tenantKey}
          tenants={v.tenants ?? []}
          autoCheck={autoCheck === search.source}
          onClose={() => {
            setAutoCheck(null);
            nav.closeDrawer();
          }}
        />
      ) : null}
      {del.dialogs}
      {credOpen ? (
        <Suspense fallback={null}>
          <CredentialSheet tenantId={v.tenantId} onClose={() => setCredOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}

/** Cờ engine off ⇒ NotFound; `member` ⇒ Forbidden (hooks nằm trong `SourcesContent`, không gọi API). */
export function SourcesPage() {
  return (
    <ProcessRouteGate>
      <AdminRoleGate />
    </ProcessRouteGate>
  );
}

function AdminRoleGate() {
  const role = useSession((s) => s.me?.role);
  if (role !== "platform_admin" && role !== "tenant_admin") return <ForbiddenState />;
  return <SourcesContent />;
}
