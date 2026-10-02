// ADM-FR-62 · M3-R03 · `combobox "Thêm người"`: ô nhập có danh sách gợi ý (role=combobox + listbox), gõ để tìm user trong tenant.
// Khác RefPicker (nút mở Popover) vì cần gõ thẳng vào chính combobox (e2e `fill`).
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type MemberOption = { username: string; label: string };
type Props = {
  options: MemberOption[];
  /** Username đã là thành viên (ẩn khỏi gợi ý). */
  taken: ReadonlySet<string>;
  isLoading: boolean;
  onQuery: (q: string) => void;
  onPick: (username: string) => void;
};

export function MemberAdder({ options, taken, isLoading, onQuery, onPick }: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = options.filter((o) => !taken.has(o.username));

  const pick = (username: string) => {
    onPick(username);
    setQuery("");
    onQuery("");
    setOpen(false);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = active + (e.key === "ArrowDown" ? 1 : -1);
      setActive(Math.min(shown.length - 1, Math.max(0, next)));
    } else if (e.key === "Enter" && shown[active]) {
      e.preventDefault();
      pick(shown[active].username);
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="relative w-80">
      <Input
        role="combobox"
        aria-label={t("groups.members.add")}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown[active] ? `${listId}-${shown[active].username}` : undefined}
        placeholder={t("groups.members.addPlaceholder")}
        autoComplete="off"
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setQuery(e.target.value);
          onQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
      />
      <div
        id={listId}
        role="listbox"
        aria-label={t("groups.members.add")}
        hidden={!open || query.trim() === ""}
        className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
      >
        {shown.map((o, i) => (
          <div
            key={o.username}
            id={`${listId}-${o.username}`}
            role="option"
            aria-selected={i === active}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(o.username)}
            onKeyDown={onKeyDown}
            className={cn(
              "cursor-pointer rounded-sm px-2 py-1.5 text-body",
              i === active && "bg-accent text-accent-foreground",
            )}
          >
            {o.label}{" "}
            <span className="font-mono text-caption text-muted-foreground">{o.username}</span>
          </div>
        ))}
        {!isLoading && shown.length === 0 ? (
          <p className="px-2 py-1 text-caption text-muted-foreground">{t("picker.empty")}</p>
        ) : null}
        {isLoading ? (
          <p className="px-2 py-1 text-caption text-muted-foreground">{t("common.loading")}</p>
        ) : null}
      </div>
    </div>
  );
}
