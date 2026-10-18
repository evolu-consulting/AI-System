// HUB-FR-147 · AC-H45 · P-d2 (plan-frontend-d2 §11): tin thread "Rẽ nhánh: tới bước {{step}} (luật {{rule}})" — `step = to_step + 1`.
import type { RoomMessage, RoomProcessPart } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";

type Props = { message: RoomMessage; part: Extract<RoomProcessPart, { kind: "branch" }> };

export function BranchMessage({ message, part }: Props) {
  const { t } = useTranslation();
  return (
    <p data-seq={message.seq} className="py-1 text-sm text-secondary-foreground">
      {t("process.thread.branch", { step: part.to_step + 1, rule: part.rule })}
    </p>
  );
}
