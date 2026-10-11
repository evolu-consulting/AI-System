// PB-R05 · một dòng giải thích dưới lý do "Cần người quyết" (hiện chỉ `source_unresolvable`); mã khác không vẽ gì.
import type { DecisionReason } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { reasonHintKey } from "../lib/decision-reason";

export function ReasonHint({ reason }: { reason: DecisionReason }) {
  const { t } = useTranslation();
  const key = reasonHintKey(reason);
  return key ? <p className="text-caption text-muted-foreground">{t(key)}</p> : null;
}
