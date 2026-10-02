// ADM-FR-62 · M3-R24 · tab Agent của group: "Chưa khả dụng" tới M5 (không gọi API).
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";

export function AgentTab() {
  const { t } = useTranslation();
  return (
    <Card className="max-w-xl">
      <CardContent className="flex items-start gap-3 pt-6">
        <Bot aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">{t("common.unavailable")}</p>
          <p className="text-body text-muted-foreground">{t("groups.agents.body")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
