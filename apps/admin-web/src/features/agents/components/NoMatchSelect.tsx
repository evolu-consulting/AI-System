// HUB-FR-77 · CR-054 · Orchestrator mặc định: "Không khớp agent nào →" [agent dự phòng | Tự trả lời | Hỏi lại người dùng] → PUT default.
import type { AgentDefaults, AgentSettingsItem } from "@ai/contracts/hub-admin";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pickLocalized } from "@/lib/localized";
import { fallbackCandidates, noMatchChoice } from "../lib/agents";

type Props = {
  defaults: AgentDefaults;
  items: AgentSettingsItem[];
  disabled: boolean;
  onChange: (choice: string) => void;
};

export function NoMatchSelect({ defaults, items, disabled, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const value = noMatchChoice(defaults);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-label">
      <label htmlFor={id} className="text-muted-foreground">
        {t("agents.noMatch.label")}
      </label>
      <Select value={value} disabled={disabled} onValueChange={(v) => v !== value && onChange(v)}>
        <SelectTrigger id={id} size="sm" className="h-8 w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fallbackCandidates(items, defaults.default_agent_id).map((a) => (
            <SelectItem key={a.agent.id} value={a.agent.id}>
              {pickLocalized(a.agent.name, i18n.language)}
            </SelectItem>
          ))}
          <SelectItem value="answer">{t("agents.noMatch.answer")}</SelectItem>
          <SelectItem value="ask">{t("agents.noMatch.ask")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
