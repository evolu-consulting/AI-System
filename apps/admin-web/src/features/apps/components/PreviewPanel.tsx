// CR-118 · cr118-app-config · khung xem trước một vai: trái = menu như người đó sẽ thấy (mục ẩn gạch mờ kèm lý do), phải = hành động
// chính + quy trình chạy ở từng khe. Thuần trình bày — kết quả đến từ `previewApp`.
import type { HideReason, PreviewRole, RolePreview } from "@ai/contracts";
import { Check, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";

function useReason() {
  const { t } = useTranslation();
  return (r: HideReason | undefined): string => {
    if (!r) return "";
    switch (r.code) {
      case "app_off":
        return t("appcfg.reason.appOff");
      case "need_level":
        return t("appcfg.reason.needLevel", { level: t(`tenants.features.level.${r.level}`) });
      case "need_addon":
        return t("appcfg.reason.needAddon", { addon: r.label });
      case "company_admin_only":
        return t("appcfg.reason.adminOnly");
      case "partner_never":
        return t("appcfg.reason.partnerNever");
      case "no_role":
        return t("appcfg.reason.noRole", { level: t(`tenants.features.level.${r.level}`) });
    }
  };
}

function Row({ visible, label, reason }: { visible: boolean; label: string; reason?: string }) {
  const Icon = visible ? Check : EyeOff;
  return (
    <li
      className={cn("flex items-start gap-2 text-body", !visible && "text-muted-foreground")}
      data-visible={visible}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">
        <span className={cn(!visible && "line-through")}>{label}</span>
        {reason ? <span className="block text-caption no-underline">{reason}</span> : null}
      </span>
    </li>
  );
}

export function PreviewPanel({
  appName,
  role,
  data,
}: {
  appName: string;
  role: PreviewRole;
  data: RolePreview;
}) {
  const { t } = useTranslation();
  const reason = useReason();
  const visibleNav = data.nav.filter((n) => n.visible);
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid={`preview-${role}`}>
      <section
        aria-label={t("appcfg.preview.sidebar")}
        className="space-y-3 rounded-xl border border-border bg-card p-4"
      >
        <h3 className="text-label font-semibold">{t("appcfg.preview.sidebar")}</h3>
        {data.appVisible ? (
          <p className="text-caption font-semibold uppercase text-muted-foreground">{appName}</p>
        ) : (
          <p role="note" className="rounded-md bg-muted px-3 py-2 text-caption">
            {t("appcfg.preview.noGroup", { app: appName })}
          </p>
        )}
        <ul className="space-y-2">
          {data.nav.map((n) => (
            <Row key={n.key} visible={n.visible} label={n.label} reason={reason(n.reason)} />
          ))}
        </ul>
      </section>
      <div className="space-y-4">
        <section
          aria-label={t("appcfg.preview.actions")}
          className="space-y-2 rounded-xl border border-border bg-card p-4"
        >
          <h3 className="text-label font-semibold">{t("appcfg.preview.actions")}</h3>
          {visibleNav.length === 0 ? (
            <p className="text-body text-muted-foreground">{t("appcfg.preview.noScreens")}</p>
          ) : (
            visibleNav.map((n) => (
              <div key={n.key} className="space-y-1">
                <p className="text-caption font-semibold">{n.label}</p>
                {n.actions.length === 0 ? (
                  <p className="text-caption text-muted-foreground">
                    {t("appcfg.preview.viewOnly")}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {n.actions.map((a) => (
                      <Row
                        key={a.key}
                        visible={a.visible}
                        label={a.label}
                        reason={reason(a.reason)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </section>
        <section
          aria-label={t("appcfg.preview.flows")}
          className="space-y-2 rounded-xl border border-border bg-card p-4"
        >
          <h3 className="text-label font-semibold">{t("appcfg.preview.flows")}</h3>
          {data.slots.length === 0 ? (
            <p className="text-body text-muted-foreground">
              {t(role === "partner" ? "appcfg.preview.flowsPartner" : "appcfg.preview.flowsNone")}
            </p>
          ) : (
            data.slots.map((s) => (
              <div key={s.slot} className="space-y-1" data-testid={`preview-slot-${s.slot}`}>
                <p className="flex flex-wrap items-center gap-2 text-body">
                  <span className="font-medium">{s.label}</span>
                  <StatusBadge tone={s.running ? "ok" : "off"}>
                    {t(s.running ? "appcfg.preview.running" : "appcfg.preview.notRunning")}
                  </StatusBadge>
                </p>
                <p className="text-caption text-muted-foreground">
                  {s.running
                    ? t("appcfg.preview.flowRuns", {
                        name: s.process?.name ?? "—",
                        version: s.process?.version ?? "—",
                      })
                    : `${reason(s.reason)} ${t("appcfg.preview.flowFallback")}`}
                </p>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
