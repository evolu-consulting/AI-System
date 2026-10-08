// HUB-FR-91 · menu `@` (listbox "Agent"): tên + `@key` (mono) + mô tả 1 dòng; trạng thái tải / rỗng / không khớp / lỗi (plan-frontend §1.2).
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { agentName } from "~/features/agents/lib/mention";
import type { AgentSuggest } from "../hooks/use-suggest";
import { AGENT_MENU_ID } from "../lib/menu-ids";
import { SuggestMenu } from "./SuggestMenu";

export function AgentMenu({
  suggest,
  onPick,
  title,
}: {
  suggest: AgentSuggest;
  onPick(index: number): void;
  title?: string;
}) {
  const { t, i18n } = useTranslation();
  const { status, matches, q, active, retry } = suggest;
  let notice: React.ReactNode;
  if (status === "loading") notice = t("menu.agentsLoading");
  else if (status === "empty") notice = t("menu.agentsEmpty");
  else if (status === "nomatch") notice = t("menu.agentsNoMatch", { q });
  else if (status === "error") {
    notice = (
      <span className="flex items-center gap-3">
        {t("menu.agentsError")}
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          {t("menu.retry")}
        </Button>
      </span>
    );
  }
  const options = matches.map(({ item }) => ({
    id: item.key,
    content: (
      <span className="block">
        <span className="font-medium">{agentName(item, i18n.language)}</span>
        <span className="ml-2 font-mono text-xs text-muted-foreground">{`@${item.key}`}</span>
        <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
      </span>
    ),
  }));
  return (
    <SuggestMenu
      id={AGENT_MENU_ID}
      label={t("menu.agents")}
      options={options}
      active={active}
      onPick={onPick}
      notice={notice}
      title={title}
    />
  );
}
