// HUB-FR-128 · HUB-FR-129 · P-c2 FC13 · dòng gate stage tự sửa mã: "Đạt sẽ mở PR vào <nhánh>." theo `apply_mode` + `apply_base`.
import type { AutofixStageView } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { gateLineKey } from "../../../lib/apply-view";

export function ApplyGateLine({ autofix }: { autofix: AutofixStageView | undefined }) {
  const { t } = useTranslation();
  const key = gateLineKey(autofix);
  if (!key) return null;
  return (
    <p className="text-caption text-secondary-foreground">
      {t(`process.common.apply.gate.${key}`, { base: autofix?.apply_base ?? "" })}
    </p>
  );
}
