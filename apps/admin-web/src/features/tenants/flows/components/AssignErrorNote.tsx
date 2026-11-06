// CR-121 f6 · (1) AppOffNote: việc thuộc ứng dụng công ty chưa dùng ⇒ nói rõ + link bật ở tab Ứng dụng. (2) AssignErrorNote: lỗi gán ⇒ câu nghiệp vụ + link tới nơi sửa.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useTr } from "@/lib/use-translate";
import type { AssignErrorSpec } from "../lib/assign-error";

export function AppOffNote({ tenantId, app }: { tenantId: string; app: string }) {
  const { t } = useTranslation();
  const tr = useTr();
  const name = tr(`featmeta.app.${app}.name`);
  return (
    <span className="text-caption text-muted-foreground" data-testid={`flows-app-off-${app}`}>
      {t("tenants.flows.err.appOff", { app: name })}{" "}
      <Link
        to="/tenants/$tenantId"
        params={{ tenantId }}
        search={{ tab: "apps" }}
        className="underline"
        data-testid="flows-open-apps"
      >
        {t("tenants.flows.err.openApps")}
      </Link>
    </span>
  );
}

export function AppOffInline({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  return (
    <span
      className="whitespace-nowrap text-caption text-muted-foreground"
      data-testid="flows-app-off-note"
    >
      {t("tenants.flows.appOffStatus")} —{" "}
      <Link
        to="/tenants/$tenantId"
        params={{ tenantId }}
        search={{ tab: "apps" }}
        className="underline"
        data-testid="flows-open-apps"
      >
        {t("tenants.flows.err.openApps")}
      </Link>
    </span>
  );
}

export function AssignErrorNote({ tenantId, spec }: { tenantId: string; spec: AssignErrorSpec }) {
  const { t } = useTranslation();
  const tr = useTr();
  const params = {
    ...spec.params,
    app: spec.params.app ? tr(`featmeta.app.${spec.params.app}.name`) : "",
  };
  const link =
    spec.action === "apps" ? (
      <Link
        to="/tenants/$tenantId"
        params={{ tenantId }}
        search={{ tab: "apps" }}
        className="underline"
      >
        {t("tenants.flows.err.openApps")}
      </Link>
    ) : spec.action === "groups" ? (
      <Link
        to="/tenants/$tenantId"
        params={{ tenantId }}
        search={{ tab: "members", view: "groups" }}
        className="underline"
      >
        {t("tenants.flows.err.openGroups")}
      </Link>
    ) : (
      <Link to="/processes" className="underline">
        {t("tenants.flows.err.openLibrary")}
      </Link>
    );
  return (
    <p role="alert" data-testid="flows-assign-error" className="text-body text-destructive">
      {t(spec.key, params)} {link}
    </p>
  );
}
