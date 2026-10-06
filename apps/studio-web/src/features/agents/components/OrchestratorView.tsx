// HUB-FR-60 · H4a-R08 · "Xem như Orchestrator thấy": đoạn Orchestrator nhận về agent này (bản nháp) cạnh các agent bật khác
// + badge trùng ý (Jaccard ≥ 0,6 — hàm của contract, cùng cài đặt với Hub). Chỉ để soát, không chặn lưu.
import {
  type AgentListItem,
  formatAgentForOrchestrator,
  similarAgents,
} from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";

type Props = { draftKey: string; description: string; peers: AgentListItem[] };

export function OrchestratorView({ draftKey, description, peers }: Props) {
  const { t } = useTranslation();
  const key = draftKey.trim() || t("editor.orchView.draftKey");
  const similar = similarAgents({ id: "", description }, peers)[0];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline">
          {t("editor.orchView.title")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[28rem] max-w-[90vw] space-y-3">
        <p className="text-label text-muted-foreground">{t("editor.orchView.hint")}</p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-label">
          {[
            formatAgentForOrchestrator({ key, description: description.trim() }),
            ...peers.map(formatAgentForOrchestrator),
          ].join("\n")}
        </pre>
        {similar ? (
          <Badge variant="outline" className="border-warning text-warning">
            {t("editor.orchView.overlap", {
              key: similar.agent_key,
              pct: Math.round(similar.score * 100),
            })}
          </Badge>
        ) : (
          <Badge variant="secondary">{t("editor.orchView.ok")}</Badge>
        )}
      </PopoverContent>
    </Popover>
  );
}
