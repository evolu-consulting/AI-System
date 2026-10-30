// HUB-FR-77 · HUB-FR-78 · CR-054 · các ô nhỏ của bảng Agents: Model, "Bật cho công ty", "Ai được dùng", Thao tác.
import type { AgentGrantRow, AgentSettingsItem } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pickLocalized } from "@/lib/localized";
import { isActive, modelText, type WhoChip, whoChips } from "../lib/agents";

export function ModelCell({ item }: { item: AgentSettingsItem }) {
  const { t } = useTranslation();
  return <span>{modelText(item.model) ?? t("agents.model.cliDefault")}</span>;
}

type SwitchProps = {
  item: AgentSettingsItem;
  checked: boolean;
  canEdit: boolean;
  pending: boolean;
  onToggle: (item: AgentSettingsItem, on: boolean) => void;
};

/** Chỉ platform_admin đổi được; tenant_admin thấy khoá (`aria-disabled` để tooltip vẫn nhận focus). */
export function EntitledSwitch({ item, checked, canEdit, pending, onToggle }: SwitchProps) {
  const { t, i18n } = useTranslation();
  const name = pickLocalized(item.agent.name, i18n.language);
  const sw = (
    <Switch
      checked={checked}
      aria-label={t("agents.entitled.aria", { agent: name })}
      aria-disabled={!canEdit || undefined}
      disabled={pending}
      onCheckedChange={(on) => canEdit && onToggle(item, on)}
      className={canEdit ? undefined : "cursor-not-allowed opacity-50"}
    />
  );
  const label = (
    <span className="text-label text-muted-foreground">
      {t(checked ? "agents.entitled.on" : "agents.entitled.off")}
    </span>
  );
  if (canEdit)
    return (
      <div className="flex items-center gap-2">
        {sw}
        {label}
      </div>
    );
  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>{sw}</TooltipTrigger>
        <TooltipContent>{t("agents.entitled.platformOnly")}</TooltipContent>
      </Tooltip>
      {label}
    </div>
  );
}

function chipLabel(
  c: WhoChip,
  t: (k: "agents.who.tenant" | "agents.who.none" | "agents.who.off") => string,
  lang: string,
) {
  if (c.kind === "group") return pickLocalized(c.name, lang);
  if (c.kind === "user") return c.name;
  return t(`agents.who.${c.kind}`);
}

export function WhoCell({
  item,
  rows,
}: {
  item: AgentSettingsItem;
  rows: readonly AgentGrantRow[];
}) {
  const { t, i18n } = useTranslation();
  const chips = whoChips(item, rows);
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <Badge
          key={"id" in c ? c.id : c.kind}
          variant={c.kind === "none" || c.kind === "off" ? "off" : "secondary"}
        >
          {chipLabel(c, t, i18n.language)}
        </Badge>
      ))}
    </div>
  );
}

type ActionsProps = {
  item: AgentSettingsItem;
  isDefault: boolean;
  busy: boolean;
  onMakeDefault: () => void;
  onGrant: () => void;
};

export function RowActions({ item, isDefault, busy, onMakeDefault, onGrant }: ActionsProps) {
  const { t, i18n } = useTranslation();
  const name = pickLocalized(item.agent.name, i18n.language);
  const active = isActive(item);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {active && !isDefault ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          aria-label={t("agents.action.makeDefaultAria", { agent: name })}
          onClick={onMakeDefault}
        >
          {t("agents.action.makeDefault")}
        </Button>
      ) : null}
      {item.is_orchestrator ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!active}
          aria-label={t("agents.action.grantAria", { agent: name })}
          onClick={onGrant}
        >
          {t("agents.action.grant")}
        </Button>
      )}
    </div>
  );
}
