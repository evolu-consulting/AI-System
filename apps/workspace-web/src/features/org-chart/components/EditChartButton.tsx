// CR-139d · nút «Chỉnh sơ đồ» (quản trị công ty): mở tab Cơ cấu ở ai-admin qua SSO. Dùng ở Sơ đồ tổ chức và Thành viên & phòng ban.
import { openInNewTab } from "@ai/web-kit/auth/open-tab";
import { toast } from "@ai/web-kit/ui/toast";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Btn } from "~/components/ui/Btn";
import { useSession } from "~/features/auth/hooks/use-session";
import { canEditOrg, orgEditorUrl } from "../lib/org-editor-link";

export function EditChartButton() {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const [busy, setBusy] = useState(false);
  if (!me || !canEditOrg(me.role)) return null;
  const go = async () => {
    setBusy(true);
    const ok = await openInNewTab(() => orgEditorUrl(me.tenant.id));
    setBusy(false);
    if (!ok) toast(t("contracts.orgChart.editFail"), "late");
  };
  return (
    <Btn variant="outline" data-testid="org-edit" disabled={busy} onClick={() => void go()}>
      {t("contracts.orgChart.edit")}
    </Btn>
  );
}
