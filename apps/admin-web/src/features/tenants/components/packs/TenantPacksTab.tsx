// PK-FR-05 · D-05 · UAT CR-095 B3: tab "Gói" của chi tiết tenant — platform_admin bật/tắt gói nghiệp vụ (vd Hợp đồng) cho công
// ty. Bật ⇒ admin-api tạo 3 Group vai + grant + trợ lý AI của gói (B4). Tab không có form ⇒ không UnsavedGuard. Nạp lười.
import type { PackState } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { Switch } from "@/components/ui/switch";
import type { Translate } from "@/lib/format";
import { packLabel, useTenantPackList } from "../../hooks/use-tenant-packs";
import { TenantProcessSlots } from "../slots/TenantProcessSlots";

function packColumns(
  t: Translate,
  pendingKey: string | null,
  onToggle: (row: PackState, want: boolean) => void,
): Column<PackState>[] {
  return [
    {
      id: "name",
      header: t("tenants.packs.col.name"),
      cell: (r) => (
        <span>
          {packLabel(t, r.key)}{" "}
          <span className="font-mono text-label text-muted-foreground">{r.key}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: t("tenants.packs.col.status"),
      cell: (r) =>
        r.enabled ? (
          <StatusBadge tone="ok">{t("tenants.packs.on")}</StatusBadge>
        ) : (
          <StatusBadge tone="off">{t("tenants.packs.off")}</StatusBadge>
        ),
    },
    {
      id: "on",
      header: t("tenants.packs.col.on"),
      className: "w-40",
      cell: (r) => (
        <Switch
          aria-label={t("tenants.packs.switchAria", { name: packLabel(t, r.key) })}
          checked={r.enabled}
          disabled={pendingKey === r.key}
          onCheckedChange={(want) => onToggle(r, want)}
        />
      ),
    },
  ];
}

export default function TenantPacksTab({ tenant }: { tenant: { id: string; name: string } }) {
  const { t } = useTranslation();
  const tt = t as unknown as Translate;
  const packs = useTenantPackList(tenant);
  if (packs.forbidden) return <ForbiddenState />;
  const header = (
    <div className="border-b border-border px-4 py-3">
      <h2 className="text-h3 font-semibold">{t("tenants.packs.title")}</h2>
      <p className="text-caption text-muted-foreground">{t("tenants.packs.desc")}</p>
    </div>
  );
  const offName = packs.off ? packLabel(tt, packs.off.key) : "";
  return (
    <section className="space-y-4" aria-label={t("tenants.packs.title")}>
      <DataTable
        header={header}
        caption={t("tenants.packs.title")}
        columns={packColumns(tt, packs.pendingKey, packs.toggle)}
        rows={packs.list.data?.items}
        getRowKey={(r) => r.key}
        isLoading={packs.list.isPending}
        isFetching={packs.list.isFetching}
        error={packs.loadError}
        onRetry={() => void packs.list.refetch()}
        empty={<EmptyState message={t("tenants.packs.empty")} />}
      />
      <ConfirmDialog
        open={packs.off !== null}
        onOpenChange={(o) => !o && packs.cancelOff()}
        title={t("tenants.packs.offTitle", { name: offName })}
        description={t("tenants.packs.offBody")}
        confirmLabel={t("tenants.packs.offConfirm")}
        destructive
        onConfirm={packs.confirmOff}
      />
      <TenantProcessSlots tenant={tenant} />
    </section>
  );
}
