// CR-112 · CR-121 c12 (R3) · tab "Ứng dụng" của chi tiết công ty (artboard Company): BẢNG mỗi hàng một app — Quyền truy cập
// (Tắt/Xem/Sửa/Quản trị điều khiển CẢ gói lẫn entitlement) · Trạng thái + lý do · Thành viên · Quy trình ("2 bật · 1 tắt").
// Dải "Cần xử lý" mở ngăn Gán ở tab Quy trình (Q5); 4 ô số chỉ xem. Lưu một lượt, một hộp xác nhận. Chỉ platform_admin sửa
// (tenant_admin: xem). Nạp lười. (Giữ tên/đường dẫn file cũ để workspace không phải đổi dòng import.)
import { CONTRACTS_PARTNER_CONFIRM_FEATURE } from "@ai/contracts/light";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { useSession } from "@/lib/auth/use-session";
import { loadError } from "@/lib/load-error";
import { useTr } from "@/lib/use-translate";
import { AppsTable, AttentionStrip, StatTiles, type Tile } from "../../apps/components/AppsTable";
import { appsOnCount, attentionOf, flowCounts, isAppOn } from "../../apps/lib/apps-table";
import { useCompanyFlows } from "../../flows/hooks/use-company-flows";
import { useAppsTab } from "../../hooks/use-apps-tab";
import { useTenantOverview } from "../../hooks/use-tenant-overview";
import { appsConfirmMessage, needsConfirm } from "../../lib/apps-confirm";
import { packOf, roleStats } from "../../lib/apps-plan";
import { detectLevel } from "../../lib/feature-assign";
import type { MemberView, TenantTab } from "../../lib/workspace-tabs";
import { PartnerConfirmCard } from "../../partner/PartnerConfirmCard";
import { AppsSaveBar } from "./AppsSaveBar";

type Props = {
  tenant: {
    id: string;
    name: string;
    user_count?: number;
    process_runs_max?: number;
  };
  onDirtyChange: (dirty: boolean) => void;
  /** Giữ để nơi gọi (wizard onboard) không đổi; CR-127 Z7: "Gán" luôn đi sang tab Quy trình (không còn hộp gán mẫu). */
  inWizard?: boolean;
};

/** Tab của workspace (cr112-nav/rbac-ui, c11); giữ ở dạng chuỗi để không phụ thuộc kiểu `TenantTab` của lát khác. */
const ACCESS_TAB: string = "members";
const FLOWS_TAB: string = "processes";

export default function TenantFeaturesTab({ tenant, onDirtyChange }: Props) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const navigate = useNavigate();
  const readOnly = useSession((s) => s.me?.role) !== "platform_admin";
  const a = useAppsTab(tenant, onDirtyChange);
  const flows = useCompanyFlows(tenant.id);
  const overview = useTenantOverview(tenant.id);
  const [confirm, setConfirm] = useState(false);
  const { value } = a;
  const err = loadError(a.query.error) ?? (readOnly ? null : loadError(a.packsQ.error));
  if (err) {
    return (
      <ErrorState
        message={err.message}
        code={err.code}
        onRetry={() => {
          void a.query.refetch();
          void a.packsQ.refetch();
        }}
      />
    );
  }
  if (a.query.isPending || (!readOnly && a.packsQ.isPending)) return <LoadingState />;
  const go = (tab: string, job?: string, view?: string) =>
    void navigate({
      to: "/tenants/$tenantId",
      params: { tenantId: tenant.id },
      search: {
        tab: tab as TenantTab,
        ...(job ? { job } : {}),
        ...(view ? { view: view as MemberView } : {}),
      },
    });
  const appName = (pack: string) => tr(`featmeta.app.${pack}.name`);
  const requestSave = () => (needsConfirm(a.plan) ? setConfirm(true) : void a.save());
  const { plan } = a;
  const cards = a.cards;
  const onApp = new Set<string>(a.cards.filter((c) => isAppOn(c, value)).map((c) => c.app));
  const attention = attentionOf(flows.groups, (app) => onApp.has(app));
  const counts = flowCounts(flows.groups);
  const rows = cards.map((shown) => {
    // UX-S7 · "Đối tác xác nhận" có công tắc + điều kiện riêng ở thẻ phía trên: không còn công tắc thứ hai trong bảng (Luật GỐC 2).
    const card = {
      ...shown,
      addons: shown.addons.filter((f) => f.key !== CONTRACTS_PARTNER_CONFIRM_FEATURE),
    };
    const pack = packOf(card, a.packs);
    const level = detectLevel(card, value).level;
    return {
      card,
      draft: value,
      readOnly,
      members: pack?.member_count ?? null,
      meta: pack
        ? {
            pack,
            roles: roleStats(a.roles, pack.key, level),
            partners: a.partners,
            onOpenAccess: () => go(ACCESS_TAB, undefined, "access"),
          }
        : null,
      flows: counts.get(card.app),
      offSlots: attention.filter((x) => x.app === card.app).map((x) => x.slot),
      onChange: a.change,
      onLevel: a.changeLevel,
      onOpenFlows: () => go(FLOWS_TAB),
    };
  });
  const quota = overview.quota;
  const appsOn = appsOnCount(a.cards, value);
  const tiles: Tile[] = [
    {
      label: t("tenants.apps.tile.users"),
      value: String(tenant.user_count ?? "—"),
      sub: t("tenants.apps.tile.usersUnit"),
    },
    {
      label: t("tenants.apps.tile.apps"),
      value: String(appsOn.on),
      sub: `/ ${appsOn.total}`,
    },
    {
      label: t("tenants.apps.tile.runs"),
      value: String(tenant.process_runs_max ?? "—"),
      sub: t("tenants.apps.tile.runsUnit"),
    },
    {
      label: t("tenants.apps.tile.plan"),
      value:
        quota?.max_runs != null
          ? t("tenants.apps.tile.planRuns", { n: quota.max_runs })
          : t("tenants.apps.tile.planUnlimited"),
    },
  ];
  return (
    <div className="space-y-6">
      <section aria-label={t("tenants.apps.title")} className="space-y-4">
        <AttentionStrip items={attention} onAssign={(slot) => go(FLOWS_TAB, slot)} />
        <AppsTable rows={rows} />
        <PartnerConfirmCard tenantId={tenant.id} canEdit={!readOnly} onOpen={(tab) => go(tab)} />
        <StatTiles tiles={tiles} onOpenFlows={() => go(FLOWS_TAB)} />
        {readOnly ? null : (
          <AppsSaveBar
            plan={plan}
            dirty={a.dirty}
            saving={a.saving}
            onReset={a.reset}
            onSave={requestSave}
          />
        )}
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t("tenants.features.confirmTitle", { tenant: tenant.name })}
          description={appsConfirmMessage(tr, i18n.language, plan, a.packs, appName)}
          confirmLabel={t("common.save")}
          destructive
          onConfirm={a.save}
        />
      </section>
    </div>
  );
}
