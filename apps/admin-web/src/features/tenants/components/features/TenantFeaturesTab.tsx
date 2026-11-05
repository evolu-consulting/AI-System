// CR-112 · ADM-FR-78 · tab "Ứng dụng & Gói" của chi tiết công ty (hợp nhất Feature CR-111 + Gói): mỗi app một thẻ chọn mức
// Tắt/Xem/Sửa/Quản trị — mức điều khiển CẢ gói (bật/tắt) lẫn entitlement; lưu một lượt, một hộp xác nhận. Chỉ platform_admin sửa
// (tenant_admin: xem). Nạp lười. (Giữ tên/đường dẫn file cũ để workspace không phải đổi dòng import.)
import { getAppManifest } from "@ai/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/use-session";
import { loadError } from "@/lib/load-error";
import { useTr } from "@/lib/use-translate";
import { useAppsTab } from "../../hooks/use-apps-tab";
import { appsConfirmMessage, needsConfirm } from "../../lib/apps-confirm";
import { packOf, roleStats } from "../../lib/apps-plan";
import { detectLevel } from "../../lib/feature-assign";
import type { TenantTab } from "../../lib/workspace-tabs";
import { TenantProcessSlots } from "../slots/TenantProcessSlots";
import { AppCard } from "./AppCard";
import { AppsSaveBar } from "./AppsSaveBar";

type Props = {
  tenant: { id: string; name: string };
  onDirtyChange: (dirty: boolean) => void;
  /** CR-118: chỉ hiện thẻ của một app (ngăn "Công ty" của trang cấu hình app) — cùng AppCard, cùng một đường lưu. */
  onlyApp?: string;
  /** CR-118: báo bản nháp chưa lưu (tập key feature) cho màn "Xem trước"; null khi không có thay đổi. */
  onDraft?: (keys: ReadonlySet<string> | null) => void;
};

/** Tab Phân quyền của workspace (cr112-nav/rbac-ui); giữ ở dạng chuỗi để không phụ thuộc kiểu `TenantTab` của lát khác. */
const ACCESS_TAB: string = "access";

export default function TenantFeaturesTab({ tenant, onDirtyChange, onlyApp, onDraft }: Props) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const navigate = useNavigate();
  const readOnly = useSession((s) => s.me?.role) !== "platform_admin";
  const a = useAppsTab(tenant, onDirtyChange);
  const [confirm, setConfirm] = useState(false);
  const { dirty, value } = a;
  useEffect(() => {
    onDraft?.(dirty ? value : null);
  }, [onDraft, dirty, value]);
  useEffect(() => () => onDraft?.(null), [onDraft]);
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
  const openAccess = () =>
    void navigate({
      to: "/tenants/$tenantId",
      params: { tenantId: tenant.id },
      search: { tab: ACCESS_TAB as TenantTab },
    });
  const appName = (pack: string) => tr(`featmeta.app.${pack}.name`);
  const requestSave = () => (needsConfirm(a.plan) ? setConfirm(true) : void a.save());
  const { plan } = a;
  return (
    <div className="space-y-6">
      <section aria-label={t("tenants.apps.title")} className="space-y-4">
        {onlyApp ? null : (
          <div>
            <h2 className="text-h3 font-semibold">{t("tenants.apps.title")}</h2>
            <p className="text-caption text-muted-foreground">
              {t(readOnly ? "tenants.apps.descReadOnly" : "tenants.apps.desc")}
            </p>
          </div>
        )}
        <div className={onlyApp ? "grid gap-4" : "grid items-start gap-4 lg:grid-cols-2"}>
          {a.cards
            .filter((c) => !onlyApp || c.app === onlyApp)
            .map((card) => {
              const pack = packOf(card, a.packs);
              const level = detectLevel(card, a.value).level;
              return (
                <AppCard
                  key={card.app}
                  card={card}
                  draft={a.value}
                  onChange={a.change}
                  onLevel={a.changeLevel}
                  readOnly={readOnly}
                  slots={
                    readOnly
                      ? null
                      : (engine) => (
                          <TenantProcessSlots tenant={tenant} app={card.app} engine={engine} />
                        )
                  }
                  headerAction={
                    !onlyApp && !readOnly && getAppManifest(card.app) && card.mode === "levels" ? (
                      <Button variant="link" size="sm" className="h-auto p-0" asChild>
                        <Link to="/apps/$appKey" params={{ appKey: card.app }}>
                          {t("appcfg.openApp")}
                        </Link>
                      </Button>
                    ) : null
                  }
                  meta={
                    pack
                      ? {
                          pack,
                          roles: roleStats(a.roles, pack.key, level),
                          partners: a.partners,
                          onOpenAccess: openAccess,
                        }
                      : null
                  }
                />
              );
            })}
        </div>
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
