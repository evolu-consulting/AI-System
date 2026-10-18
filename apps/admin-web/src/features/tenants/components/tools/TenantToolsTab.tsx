// ADM-FR-73 · AC-A15 · P-d2 (plan-frontend-d2 §12; mockup 02 C1–C5): tab "Tool quy trình" của chi tiết tenant — bật/tắt workflow nào
// công ty gọi được ở giai đoạn "Gọi tool". Tab không có form ⇒ không UnsavedGuard. Nạp lười từ `TenantDetailPage`.
import type { TenantDetail } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/shared/DataTable";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { buttonVariants } from "@/components/ui/button";
import type { Translate } from "@/lib/format";
import { filterTools, useTenantTools } from "../../hooks/use-tenant-tools";
import { ToolOffDialog } from "./ToolOffDialog";
import { toolColumns } from "./ToolRow";

export default function TenantToolsTab({ tenant }: { tenant: TenantDetail }) {
  const { t, i18n } = useTranslation();
  const tools = useTenantTools(tenant);
  const [q, setQ] = useState("");
  const items = tools.list.data?.items;
  const rows = useMemo(() => (items ? filterTools(items, q) : undefined), [items, q]);
  const locale = i18n.language === "vi" ? "vi-VN" : "en-GB";
  const columns = toolColumns(t as unknown as Translate, locale, tools.pendingId, tools.toggle);
  if (tools.forbidden) return <ForbiddenState />;
  const noMatch = (
    <EmptyState
      message={t("tenants.tools.noMatch")}
      className="rounded-none border-0 border-t border-solid"
    />
  );
  const none = (
    <EmptyState
      title={t("tenants.tools.empty")}
      message={t("tenants.tools.emptyDesc")}
      action={
        <Link to="/workflows" className={buttonVariants({ variant: "outline" })}>
          {t("tenants.tools.openWorkflows")}
        </Link>
      }
    />
  );
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div>
        <h2 className="text-h3 font-semibold">{t("tenants.tools.title")}</h2>
        <p className="text-caption text-muted-foreground">{t("tenants.tools.desc")}</p>
      </div>
      <SearchBox label={t("tenants.tools.search")} value={q} onChange={setQ} />
    </div>
  );
  return (
    <section className="space-y-4" aria-label={t("tenants.tools.title")}>
      <DataTable
        header={items && items.length === 0 ? undefined : header}
        caption={t("tenants.tools.title")}
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.workflow_id}
        isLoading={tools.list.isPending}
        isFetching={tools.list.isFetching}
        error={tools.loadError}
        onRetry={() => void tools.list.refetch()}
        empty={items && items.length > 0 ? noMatch : none}
      />
      <ToolOffDialog tool={tools.off} onCancel={tools.cancelOff} onConfirm={tools.confirmOff} />
    </section>
  );
}
