// ADM-FR-20, ADM-FR-30 · M2 · combobox mở Popover có ô tìm + listbox (↑↓ Enter Esc), ≤ 50 mục + "Còn {n} kết quả".
// Tự viết bằng Popover + listbox, không dùng cmdk (plan-frontend D1).
import { ChevronsUpDown } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { moveActive, type PickerOption, visibleOptions } from "./ref-picker";

const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  /** Tên truy cập của combobox (vd "Thêm command"); cũng là chữ trên nút. */
  label: string;
  options: readonly PickerOption[];
  selectedIds?: readonly string[];
  onPick: (id: string) => void;
  isLoading?: boolean;
  /** Gọi (debounce 300 ms) khi gõ, để nơi dùng lấy thêm từ server khi tổng > 200. */
  onSearch?: (q: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** `button`: nút mở danh sách (vd `+ Cấp cho tenant`); mặc định `combobox` (vd `Thêm feature`). */
  trigger?: "combobox" | "button";
};

export function RefPicker({
  label,
  options,
  selectedIds,
  onPick,
  isLoading,
  onSearch,
  placeholder,
  disabled,
  trigger = "combobox",
}: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { shown, more } = visibleOptions(options, selectedIds, query);
  const searchLabel = placeholder ?? t("common.search");

  useEffect(() => {
    if (!onSearch || !open) return;
    const timer = setTimeout(() => onSearch(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open, onSearch]);

  const toggle = (next: boolean) => {
    setOpen(next);
    setQuery("");
    setActive(0);
  };
  const pick = (id: string) => {
    onPick(id);
    toggle(false);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => moveActive(a, e.key === "ArrowDown" ? 1 : -1, shown.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = shown[active];
      if (item) pick(item.id);
    }
  };

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role={trigger === "combobox" ? "combobox" : undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={label}
          disabled={disabled}
          className="justify-between"
        >
          {label}
          <ChevronsUpDown aria-hidden className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-2">
        <Input
          type="search"
          value={query}
          placeholder={searchLabel}
          aria-label={searchLabel}
          aria-controls={listId}
          aria-activedescendant={shown[active] ? `${listId}-${shown[active].id}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div id={listId} role="listbox" aria-label={label} className="max-h-60 overflow-y-auto">
          {shown.map((o, i) => (
            <div
              key={o.id}
              id={`${listId}-${o.id}`}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.id)}
              onKeyDown={onKeyDown}
              className={cn(
                "cursor-pointer rounded-sm px-2 py-1.5 text-body",
                i === active && "bg-accent text-accent-foreground",
              )}
            >
              {o.label}
              {o.hint ? (
                <span className="ml-2 font-mono text-caption text-muted-foreground">{o.hint}</span>
              ) : null}
            </div>
          ))}
        </div>
        {isLoading ? (
          <p className="px-2 text-caption text-muted-foreground">{t("common.loading")}</p>
        ) : null}
        {!isLoading && shown.length === 0 ? (
          <p className="px-2 text-caption text-muted-foreground">{t("picker.empty")}</p>
        ) : null}
        {more > 0 ? (
          <p className="px-2 text-caption text-muted-foreground">{t("picker.more", { n: more })}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
