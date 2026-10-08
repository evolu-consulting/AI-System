// HUB-FR-77 · CR-054 · ô "Agent": avatar chữ, tên theo ngôn ngữ, nhãn ★ Mặc định / Điều phối, `@key` · mô tả,
// và (Orchestrator đang mặc định) ô "Không khớp agent nào →".
import type { AgentDefaults, AgentSettingsItem } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { pickLocalized } from "@/lib/localized";
import { cn } from "@/lib/utils";
import { initials, isActive } from "../lib/agents";
import { NoMatchSelect } from "./NoMatchSelect";

type Props = {
  item: AgentSettingsItem;
  items: AgentSettingsItem[];
  defaults: AgentDefaults | null;
  busy: boolean;
  onNoMatch: (current: AgentDefaults, choice: string) => void;
};

export function AgentCell({ item, items, defaults, busy, onNoMatch }: Props) {
  const { t, i18n } = useTranslation();
  const name = pickLocalized(item.agent.name, i18n.language);
  const isDefault = defaults?.default_agent_id === item.agent.id;
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg text-label font-bold",
          isActive(item) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {initials(name)}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5 font-medium">
          {name}
          {isDefault ? <StatusBadge tone="info">{t("agents.badge.default")}</StatusBadge> : null}
          {item.is_orchestrator ? (
            <StatusBadge tone="warn">{t("agents.badge.orchestrator")}</StatusBadge>
          ) : null}
        </span>
        <span className="text-label text-muted-foreground">
          <span className="font-mono">@{item.agent.key}</span>
          {item.description ? ` · ${item.description}` : null}
        </span>
        {isDefault && item.is_orchestrator && defaults ? (
          <NoMatchSelect
            defaults={defaults}
            items={items}
            disabled={busy}
            onChange={(choice) => onNoMatch(defaults, choice)}
          />
        ) : null}
      </div>
    </div>
  );
}
