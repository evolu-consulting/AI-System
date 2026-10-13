// CR-056 · P-c1 · lý do "Cần người quyết" trong thẻ: 2 mã tự sửa mã ⇒ heading, mã khác ⇒ đoạn văn; kèm câu hướng dẫn (nếu có).
import type { DecisionReason } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { Badge } from "../autofix/Badge";
import { isAutofixReason, reasonKey, reasonParams } from "../lib/decision-reason";
import { ReasonHint } from "./ReasonHint";

export function ReasonLines({ reason, round }: { reason: DecisionReason; round?: number }) {
  const { t } = useTranslation();
  return (
    <>
      {isAutofixReason(reason) ? (
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{t(reasonKey(reason))}</h3>
          {round !== undefined && (
            <Badge variant="info">{t("process.common.autofix.round", { n: round })}</Badge>
          )}
        </div>
      ) : (
        <p className="text-caption text-secondary-foreground">
          {t(reasonKey(reason), reasonParams(reason))}
        </p>
      )}
      <ReasonHint reason={reason} />
    </>
  );
}
