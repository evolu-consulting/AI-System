// CR-105 L4 · nút/ liên kết "Chỉnh quy trình duyệt" → ai-admin; chỉ hiện cho người có quyền sửa (platform_admin).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { useSession } from "~/features/auth/hooks/use-session";
import { canEditFlow, flowEditorUrl } from "../lib/editor-link";

export function FlowEditorLink({ className, testId }: { className?: string; testId?: string }) {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const [busy, setBusy] = useState(false);
  if (!canEditFlow(role)) return null;
  const go = async () => {
    setBusy(true);
    const url = await flowEditorUrl();
    setBusy(false);
    if (url) window.location.assign(url);
    else toast(t("contracts.flow.current.openFail"), "late");
  };
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={busy}
      className={className ?? "text-caption text-act underline"}
      onClick={() => void go()}
    >
      {t("contracts.flow.current.editLink")}
    </button>
  );
}
