// CR-112 · ADM-FR-79 · khung bước 2-4 của wizard (công ty đã tồn tại): tải công ty, thân bước, nút Quay lại / Tiếp tục / Bỏ qua / Hoàn tất / Thoát.
import type { TenantDetail } from "@ai/contracts/tenants";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api-error";
import { isSkippable, nextStep, prevStep, stepNumber, type WizardStep } from "../../lib/wizard";
import { WizardAppsStep, WizardPeopleStep, WizardReviewStep } from "./WizardSteps";

type Props = {
  step: Exclude<WizardStep, "company">;
  tenant: { data?: TenantDetail; error: unknown; isPending: boolean; refetch: () => unknown };
  onGo: (s: WizardStep) => void;
  onFinish: () => void;
  onExit: () => void;
};

function Body({
  step,
  tenant,
  onDirtyChange,
}: {
  step: Props["step"];
  tenant: TenantDetail;
  onDirtyChange: (d: boolean) => void;
}) {
  if (step === "apps") return <WizardAppsStep tenant={tenant} onDirtyChange={onDirtyChange} />;
  if (step === "people") return <WizardPeopleStep tenant={tenant} onDirtyChange={onDirtyChange} />;
  return <WizardReviewStep tenant={tenant} />;
}

export function WizardTenantStep({ step, tenant: q, onGo, onFinish, onExit }: Props) {
  const { t } = useTranslation();
  const [dirty, setDirty] = useState(false);
  if (q.isPending) return <LoadingState />;
  if (q.error || !q.data) {
    const err = q.error instanceof ApiError ? q.error : null;
    if (err?.status === 404) return <NotFoundState backTo="/tenants" />;
    return (
      <ErrorState
        message={err?.message ?? ""}
        code={err?.code ?? "NETWORK_ERROR"}
        onRetry={() => void q.refetch()}
      />
    );
  }
  const next = nextStep(step);
  const prev = prevStep(step);
  return (
    <div className="space-y-4">
      <h2 className="text-h3 font-semibold">
        {t("tenants.wizard.stepOf", { n: stepNumber(step), total: 4 })} ·{" "}
        {t(`tenants.wizard.step.${step}`)}
      </h2>
      <Card>
        <CardContent className="pt-6">
          <Body step={step} tenant={q.data} onDirtyChange={setDirty} />
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        {prev ? (
          <Button variant="outline" onClick={() => onGo(prev)} disabled={dirty}>
            {t("tenants.wizard.back")}
          </Button>
        ) : null}
        <Button onClick={() => (next ? onGo(next) : onFinish())} disabled={dirty}>
          {t(next ? "tenants.wizard.next" : "tenants.wizard.finish")}
        </Button>
        {next && isSkippable(step) ? (
          <Button variant="ghost" onClick={() => onGo(next)} disabled={dirty}>
            {t("tenants.wizard.skip")}
          </Button>
        ) : null}
        <Button variant="ghost" className="ml-auto" onClick={onExit}>
          {t("tenants.wizard.exit")}
        </Button>
      </div>
      {dirty ? (
        <p role="status" className="text-caption text-muted-foreground">
          {t("tenants.wizard.saveFirst")}
        </p>
      ) : null}
      <UnsavedGuard dirty={dirty} />
    </div>
  );
}
