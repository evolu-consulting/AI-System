// CR-056 · P-c1 · lý do "Cần người quyết" trong thẻ: 2 mã tự sửa mã ⇒ heading, mã khác ⇒ đoạn văn; kèm câu hướng dẫn (nếu có).
import type { DecisionReason } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { isAutofixReason, reasonKey, reasonParams } from "../lib/decision-reason";
import { ReasonHint } from "./ReasonHint";

export function ReasonLines({ reason }: { reason: DecisionReason }) {
  const { t } = useTranslation();
  return (
    <>
      {isAutofixReason(reason) ? (
        <h3 className="text-sm font-semibold">{t(reasonKey(reason))}</h3>
      ) : (
        <p className="text-caption text-secondary-foreground">
          {t(reasonKey(reason), reasonParams(reason))}
        </p>
      )}
      <ReasonHint reason={reason} />
    </>
  );
}
