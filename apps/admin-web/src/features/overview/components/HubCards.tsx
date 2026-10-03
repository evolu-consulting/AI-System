// ADM-FR-42 · Q5 · plan-frontend D10 · hai card cần Agent Hub (Agent Studio, Command lỗi nhiều nhất): chưa khả dụng → "Sẽ có khi Agent Hub sẵn sàng.".
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Panel } from "./Panel";

export function HubCards() {
  const { t } = useTranslation();
  return (
    <>
      <Panel title={t("overview.agentStudio.title")}>
        <p className="text-body text-muted-foreground">{t("overview.agentStudio.body")}</p>
        <Button variant="outline" size="sm" disabled>
          {t("overview.agentStudio.open")}
        </Button>
        <p className="text-caption text-muted-foreground">{t("overview.hubPending")}</p>
      </Panel>
      <Panel title={t("overview.topErrors.title")}>
        <p className="text-body text-muted-foreground">{t("overview.hubPending")}</p>
      </Panel>
    </>
  );
}
