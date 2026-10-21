// portal-home · "Ứng dụng mở khi đăng nhập": của tôi, và (tenant admin) mặc định cho cả công ty. Trống = trang chủ.
import type { MeApp, PortalResponse } from "@ai/contracts";
import { appLabel } from "@ai/web-kit/app-catalog/apps";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSetDefaultApp } from "../hooks/use-portal";

function Pick(p: {
  label: string;
  value: string | null;
  apps: readonly MeApp[];
  scope: "user" | "tenant";
  testId: string;
}) {
  const { t, i18n } = useTranslation();
  const set = useSetDefaultApp(p.scope);
  return (
    <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
      <span className="text-muted-foreground sm:w-56">{p.label}</span>
      <select
        data-testid={p.testId}
        className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
        value={p.value ?? ""}
        disabled={set.isPending}
        onChange={(e) =>
          set.mutate(e.target.value || null, {
            onSuccess: () => toast.success(t("portal.defaults.saved")),
            onError: () => toast.error(t("portal.defaults.failed")),
          })
        }
      >
        <option value="">{t("portal.defaults.home")}</option>
        {p.apps.map((a) => (
          <option key={a.key} value={a.key}>
            {appLabel(a, i18n.language)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DefaultAppPicker(p: { apps: readonly MeApp[]; info: PortalResponse }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <h2 className="text-sm font-semibold">{t("portal.defaults.title")}</h2>
      <Pick
        label={t("portal.defaults.mine")}
        value={p.info.default_app.user}
        apps={p.apps}
        scope="user"
        testId="portal-default-user"
      />
      {p.info.admin && (
        <Pick
          label={t("portal.defaults.tenant")}
          value={p.info.default_app.tenant}
          apps={p.apps}
          scope="tenant"
          testId="portal-default-tenant"
        />
      )}
    </section>
  );
}
