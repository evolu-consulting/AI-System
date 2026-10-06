// HUB-FR-60 · H4a-R11 · banner "Cần chú ý": agent đang bật nhưng chưa cấp cho tenant nào.
import type { AgentListItem } from "@ai/contracts/studio";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";

export function AttentionBanner({ agents }: { agents: readonly AgentListItem[] }) {
  const { t } = useTranslation();
  if (agents.length === 0) return null;
  return (
    <Alert className="border-transparent bg-warning-bg text-warning">
      <TriangleAlert aria-hidden />
      <AlertTitle>{t("agents.attention.title")}</AlertTitle>
      <AlertDescription className="text-warning">
        {t("agents.attention.body", {
          n: agents.length,
          keys: agents.map((a) => a.key).join(", "),
        })}
      </AlertDescription>
    </Alert>
  );
}
