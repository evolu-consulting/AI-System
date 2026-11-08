// CR-125 · S1 · C1 · bước Xem lại: danh sách việc còn thiếu (mỗi mục một liên kết "Sửa"), rỗng ⇒ "Công ty dùng được ngay".
// Nguồn: cùng hook với tab Ứng dụng (app đang bật, gói/vai, việc quy trình tắt) — không đọc thêm API riêng.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { hubConfigured } from "@/lib/hub";
import { useTr } from "@/lib/use-translate";
import { useTenantPacks } from "../../api";
import { attentionOf } from "../../apps/lib/apps-table";
import { useCompanyFlows } from "../../flows/hooks/use-company-flows";
import { useJobName } from "../../flows/lib/use-job-name";
import { useTenantOverview } from "../../hooks/use-tenant-overview";
import { type ChecklistItem, reviewChecklist } from "../../lib/review-checklist";
import type { WizardStep } from "../../lib/wizard";

type Props = {
  tenant: { id: string; user_count: number };
  isPlatform: boolean;
  onGo: (s: WizardStep) => void;
};

const linkCls = "text-label text-primary underline underline-offset-4";

export function ReviewChecklist({ tenant, isPlatform, onGo }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const jobName = useJobName();
  const o = useTenantOverview(tenant.id);
  const packs = useTenantPacks(tenant.id, isPlatform);
  const flows = useCompanyFlows(tenant.id);
  const waiting =
    o.pending || (isPlatform && packs.isPending) || (hubConfigured() && flows.pending);
  if (waiting) return null;
  const appsOn = (o.apps ?? []).map((a) => a.app as string);
  const items = reviewChecklist({
    appsOn,
    packs: isPlatform ? packs.data?.items : undefined,
    userCount: tenant.user_count,
    flowsOff: attentionOf(flows.groups, (app) => appsOn.includes(app)),
  });
  const appName = (app: string) => tr(`featmeta.app.${app}.name`);
  return (
    <section
      aria-label={t("tenants.wizard.todo.title")}
      data-testid="wizard-todo"
      className="space-y-2"
    >
      <h3 className="text-label font-semibold">{t("tenants.wizard.todo.title")}</h3>
      {items.length === 0 ? (
        <p className="text-body text-success" data-testid="wizard-todo-ok">
          {t("tenants.wizard.todo.ok")}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li
              key={keyOf(it)}
              data-testid={`wizard-todo-${it.kind}`}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-body"
            >
              <span className="min-w-0 flex-1">
                {t(`tenants.wizard.todo.${it.kind}`, {
                  app: "app" in it ? appName(it.app) : "",
                  job: "slot" in it ? jobName({ slot: it.slot }) : "",
                })}
              </span>
              <Fix it={it} id={tenant.id} onGo={onGo} label={t("tenants.wizard.todo.fix")} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const keyOf = (it: ChecklistItem): string =>
  `${it.kind}:${"app" in it ? it.app : ""}:${"slot" in it ? it.slot : ""}`;

function Fix({
  it,
  id,
  onGo,
  label,
}: {
  it: ChecklistItem;
  id: string;
  onGo: (s: WizardStep) => void;
  label: string;
}) {
  if (it.kind === "noApps" || it.kind === "noPeople") {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => onGo(it.kind === "noApps" ? "apps" : "people")}
      >
        {label}
      </Button>
    );
  }
  if (it.kind === "noUsers") {
    return (
      <Link
        to="/tenants/$tenantId"
        params={{ tenantId: id }}
        search={{ tab: "members", view: "users", drawer: "new" }}
        className={linkCls}
      >
        {label}
      </Link>
    );
  }
  return (
    <Link
      to="/tenants/$tenantId"
      params={{ tenantId: id }}
      search={{ tab: "processes", job: it.slot }}
      className={linkCls}
    >
      {label}
    </Link>
  );
}
