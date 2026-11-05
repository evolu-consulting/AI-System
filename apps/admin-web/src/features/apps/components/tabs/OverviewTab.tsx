// CR-118 · cr118-app-config · tab "Tổng quan" của app: mô tả, số công ty theo mức, số khe quy trình, cảnh báo cấu hình, địa chỉ/SSO/đối tượng.
import type { AppCatalogItem } from "@ai/contracts/app-catalog";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { useTr } from "@/lib/use-translate";
import {
  type AppWarning,
  type CompanyLevel,
  type CompanyRow,
  countByLevel,
  enabledCount,
} from "../../lib/app-config";

const LEVELS: readonly CompanyLevel[] = ["off", "read", "write", "admin"];

function useWarningText() {
  const { t } = useTranslation();
  return (w: AppWarning): string => {
    switch (w.code) {
      case "no_url":
        return t("appcfg.warn.noUrl", { count: w.count });
      case "app_disabled":
        return t("appcfg.warn.disabled", { count: w.count });
      case "flow_needs_addon":
        return t("appcfg.warn.flowNeedsAddon", {
          companies: w.companies.join(", "),
          addon: w.addon,
        });
    }
  };
}

type Props = {
  app: AppCatalogItem;
  /** Nhóm feature trùng tên (để lấy mô tả dễ hiểu); null khi app không cấu hình theo công ty. */
  appId: string | null;
  rows: CompanyRow[];
  slotCount: number;
  warnings: AppWarning[];
  onEdit: () => void;
};

export function OverviewTab({ app, appId, rows, slotCount, warnings, onEdit }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const warnText = useWarningText();
  const counts = countByLevel(rows);
  return (
    <div className="space-y-4">
      {appId ? (
        <p className="text-body text-muted-foreground">{tr(`featmeta.app.${appId}.desc`)}</p>
      ) : (
        <p className="text-body text-muted-foreground">{t("appcfg.overview.noPerCompany")}</p>
      )}
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("appcfg.overview.enabledFor")}>
          {t("appcfg.overview.enabledOf", { on: enabledCount(rows), total: rows.length })}
        </Stat>
        <Stat label={t("appcfg.overview.byLevel")}>
          {LEVELS.map((l) => `${t(`tenants.features.level.${l}`)} ${counts[l]}`).join(" · ")}
        </Stat>
        <Stat label={t("appcfg.overview.slots")}>{slotCount}</Stat>
        <Stat label={t("appcfg.overview.access")}>
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={app.sso ? "ok" : "off"}>
              {t(app.sso ? "appcfg.overview.ssoOn" : "appcfg.overview.ssoOff")}
            </StatusBadge>
            <span>{t(`apps.audience.${app.audience}`)}</span>
          </span>
        </Stat>
      </dl>
      <p className="text-body">
        <span className="text-muted-foreground">{t("appcfg.overview.url")}: </span>
        {app.url ? <span className="font-mono">{app.url}</span> : t("appcfg.overview.noUrl")}
      </p>
      <section aria-label={t("appcfg.overview.warnings")} className="space-y-2">
        <h3 className="text-label font-semibold">{t("appcfg.overview.warnings")}</h3>
        {warnings.length === 0 ? (
          <p className="text-body text-muted-foreground">{t("appcfg.overview.noWarnings")}</p>
        ) : (
          <ul className="space-y-2">
            {warnings.map((w) => (
              <li
                key={`${w.code}-${"addon" in w ? w.addon : ""}`}
                className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-caption text-warning"
              >
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                {warnText(w)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Button variant="outline" onClick={onEdit}>
        {t("appcfg.overview.edit")}
      </Button>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-body font-semibold">{children}</dd>
    </div>
  );
}
