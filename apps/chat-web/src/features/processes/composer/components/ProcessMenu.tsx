// CHAT-AC-51 · listbox "Quy trình" (menu `!`, `SuggestMenu` + `aria-activedescendant`): tên · `!key` (mono) · input_hint · "n giai đoạn".
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { optionId } from "~/features/composer/components/SuggestMenu";
import { PROCESS_MENU_ID } from "~/features/composer/lib/menu-ids";
import { cn } from "~/lib/utils";
import type { BangSuggest } from "../hooks/use-bang-suggest";

export type ProcessMenuProps = { suggest: BangSuggest; onPick(index: number): void };

export function ProcessMenu({ suggest, onPick }: ProcessMenuProps) {
  const { t } = useTranslation();
  const { status, matches, q, active, retry } = suggest;
  let notice: React.ReactNode;
  if (status === "loading") notice = t("process.composer.menu.loading");
  else if (status === "empty") notice = t("process.composer.menu.empty");
  else if (status === "nomatch") notice = t("process.composer.menu.noMatch", { q });
  else if (status === "error") {
    notice = (
      <span className="flex items-center gap-3">
        {t("process.composer.menu.error")}
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          {t("menu.retry")}
        </Button>
      </span>
    );
  }
  return (
    <div className="mb-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md">
      {notice !== undefined ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">{notice}</div>
      ) : null}
      {/* Tiêu đề nằm trong listbox (e2e đọc `listbox "Quy trình"` gồm cả tiêu đề); không phải option. */}
      <div
        id={PROCESS_MENU_ID}
        role="listbox"
        aria-label={t("process.composer.menu.label")}
        hidden={notice !== undefined}
        className="max-h-[calc(8*2.75rem)] overflow-y-auto pb-1"
      >
        <p role="presentation" className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
          {t("process.composer.menu.title")}
        </p>
        {matches.map(({ item }, i) => (
          <div
            key={item.key}
            id={optionId(PROCESS_MENU_ID, i)}
            role="option"
            tabIndex={-1}
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault(); // giữ focus ở textarea
              onPick(i);
            }}
            className={cn(
              "cursor-pointer px-3 py-1.5 text-sm",
              i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
            )}
          >
            <span className="font-medium">{item.name}</span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">{`!${item.key}`}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {t("process.composer.menu.stages", { count: item.stage_count })}
            </span>
            {item.input_hint ? (
              <span className="block truncate text-xs text-muted-foreground">
                {item.input_hint}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
