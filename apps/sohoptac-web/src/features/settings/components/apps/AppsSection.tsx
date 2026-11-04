// CR-118 §11.2 · cửa lười vào mục "Ứng dụng & quy trình": chunk riêng, chỉ nạp khi mở mục và có quyền.
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

const AppsPane = lazy(() => import("./AppsPane"));

export function AppsSection({ tenantId }: { tenantId: string | null }) {
  const { t } = useTranslation();
  if (!tenantId) return null;
  return (
    <Suspense fallback={<p className="text-dim">{t("contracts.common.loading")}</p>}>
      <AppsPane tenantId={tenantId} />
    </Suspense>
  );
}
