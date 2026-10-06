// HUB-FR-10 · menu `/` (listbox "Lệnh"): dòng `/name` + cú pháp + mô tả; trạng thái tải / rỗng / không khớp / lỗi (plan-frontend §1.1).
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { argSyntax, describe } from "~/features/commands/lib/slash";
import type { CommandSuggest } from "../hooks/use-suggest";
import { SuggestMenu } from "./SuggestMenu";

export const COMMAND_MENU_ID = "composer-command-menu";

export function CommandMenu({
  suggest,
  onPick,
}: {
  suggest: CommandSuggest;
  onPick(index: number): void;
}) {
  const { t, i18n } = useTranslation();
  const { status, matches, q, active, retry } = suggest;
  let notice: React.ReactNode;
  if (status === "loading") notice = t("menu.commandsLoading");
  else if (status === "empty") notice = t("menu.commandsEmpty");
  else if (status === "nomatch") notice = t("menu.commandsNoMatch", { q });
  else if (status === "error") {
    notice = (
      <span className="flex items-center gap-3">
        {t("menu.commandsError")}
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          {t("menu.retry")}
        </Button>
      </span>
    );
  }
  const options = matches.map(({ item, alias }) => ({
    id: item.name,
    content: (
      <span className="block">
        <span className="font-medium">{`/${item.name}`}</span>
        {item.args.map((a) => (
          <span key={a.name} className="ml-1 font-mono text-xs text-muted-foreground">
            {argSyntax(a)}
          </span>
        ))}
        {alias !== null && (
          <span className="ml-2 text-xs text-muted-foreground">{t("menu.alias", { alias })}</span>
        )}
        <span className="block text-xs text-muted-foreground">
          {describe(item.description, i18n.language)}
        </span>
      </span>
    ),
  }));
  return (
    <SuggestMenu
      id={COMMAND_MENU_ID}
      label={t("menu.commands")}
      options={options}
      active={active}
      onPick={onPick}
      notice={notice}
    />
  );
}
