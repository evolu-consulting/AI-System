// CR-182 · R7 / CR-188 · trang `/contracts/verify` (giữ route; lối vào chính là nút «Kiểm tra tệp» trên danh sách HĐ).
import { PageHeader } from "@ai/web-kit/ui/kit/page-header";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { VerifyFilePanel } from "./VerifyFilePanel";

export function VerifyFilePage() {
  const { t } = useTranslation();
  return (
    <div data-testid="verify-page">
      <PageHeader className="mb-5" title={t("contracts.verify.title")} />
      <Panel className="p-5">
        <VerifyFilePanel />
      </Panel>
    </div>
  );
}
