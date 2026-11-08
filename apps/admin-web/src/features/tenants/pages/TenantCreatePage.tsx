// ADM-FR-60 · ADM-FR-79 · /tenants/new: wizard onboard 4 bước (Thông tin → Ứng dụng & Gói → Phân quyền/Người dùng → Xem lại).
// Không giao dịch xuyên bước: bước 1 tạo công ty ngay; bước sau gọi endpoint có sẵn; trạng thái nằm trên URL (`?tenant=&step=`) nên
// tải lại / bỏ ngang đều tiếp được (ở wizard hoặc ở workspace). "Onboard lại" mở thẳng bước 2 trên công ty có sẵn.

import { notifySuccess } from "@ai/web-kit/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { useSession } from "@/lib/auth/use-session";
import { useTenantDetail } from "../api";
import { WizardCompanyStep } from "../components/wizard/WizardCompanyStep";
import { WizardStepper } from "../components/wizard/WizardStepper";
import { WizardTenantStep } from "../components/wizard/WizardTenantStep";
import { resolveStep, stepNumber, type WizardStep } from "../lib/wizard";

const route = getRouteApi("/_authed/tenants/new");

export function TenantCreatePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const isPlatform = useSession((s) => s.me?.role) === "platform_admin";
  const step = resolveStep(search);
  const tenantId = search.tenant;
  const query = useTenantDetail(tenantId ?? "", isPlatform && !!tenantId);

  // Vào bước Xem lại thì làm mới số liệu (người dùng, vai, quota) vì các bước trước đã ghi.
  useEffect(() => {
    if (step !== "review" || !tenantId) return;
    void qc.invalidateQueries({
      queryKey: ["tenants"],
      predicate: (q) => q.queryKey.includes(tenantId),
    });
  }, [step, tenantId, qc]);

  if (!isPlatform) return <ForbiddenState />;

  const go = (s: WizardStep) =>
    void navigate({ search: { tenant: tenantId, step: stepNumber(s) }, replace: true });
  const toWorkspace = (tab?: "profile") =>
    void router.navigate(
      tenantId
        ? { to: "/tenants/$tenantId", params: { tenantId }, search: { tab } }
        : { to: "/tenants" },
    );
  const finish = () => {
    if (query.data) notifySuccess(t("tenants.wizard.done", { name: query.data.name }));
    toWorkspace("profile");
  };

  return (
    <>
      <PageHeader
        title={t("tenants.wizard.title")}
        description={
          query.data
            ? t("tenants.wizard.subtitleTenant", { name: query.data.name, key: query.data.key })
            : t("tenants.wizard.subtitle")
        }
      />
      <WizardStepper current={step} />
      {step === "company" ? (
        <WizardCompanyStep
          onCancel={() => void router.navigate({ to: "/tenants" })}
          onCreated={(res) => {
            notifySuccess(t("tenants.toast.created", { key: res.tenant.key }));
            void navigate({ search: { tenant: res.tenant.id, step: 2 }, replace: true });
          }}
        />
      ) : (
        <WizardTenantStep
          key={step}
          step={step}
          tenant={query}
          onGo={go}
          onFinish={finish}
          onExit={() => toWorkspace()}
        />
      )}
    </>
  );
}
