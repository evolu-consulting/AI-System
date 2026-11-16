// CR-177 U3 · Combobox: Popover + ô tìm + listbox. Lọc không phân biệt hoa/dấu; mũi tên di chuyển (aria-activedescendant), Enter chọn, Esc đóng.
import * as React from "react";
import { cn } from "./cn";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export type ComboboxOption = { value: string; label: string };

const MARKS = /[̀-ͯ]/g;
/** So khớp không phân biệt hoa thường và dấu tiếng Việt (đ ⇒ d). */
export const foldText = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(MARKS, "").replace(/đ/g, "d");

export function filterOptions(options: ComboboxOption[], query: string): ComboboxOption[] {
  const q = foldText(query.trim());
  return q ? options.filter((o) => foldText(o.label).includes(q)) : options;
}

/** Vị trí mục đang chọn sau phím (vòng tròn); `null` nếu phím không liên quan. */
export function moveActive(key: string, i: number, n: number): number | null {
  if (n === 0) return null;
  if (key === "ArrowDown") return (i + 1) % n;
  if (key === "ArrowUp") return (i - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}

export type ComboboxProps = {
  options: ComboboxOption[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  ref?: React.Ref<HTMLButtonElement>;
};

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Chọn…",
  searchPlaceholder = "Tìm…",
  emptyText = "Không có kết quả",
  className,
  ref,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const uid = React.useId();
  const shown = filterOptions(options, query);
  const idx = Math.min(active, Math.max(shown.length - 1, 0));
  const current = options.find((o) => o.value === value);
  const pick = (o: ComboboxOption) => {
    onValueChange(o.value);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const next = moveActive(e.key, idx, shown.length);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    } else if (e.key === "Enter" && shown[idx]) {
      e.preventDefault();
      pick(shown[idx]);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={ref}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${uid}-list`}
          data-slot="combobox-trigger"
          className={cn(
            "flex h-[var(--control-md)] w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm transition-colors duration-[var(--duration-fast)] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            !current && "text-muted-foreground",
            className,
          )}
        >
          {current?.label ?? placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
        <input
          data-slot="combobox-input"
          // biome-ignore lint/a11y/noAutofocus: ô tìm nhận focus khi mở danh sách
          autoFocus
          aria-controls={`${uid}-list`}
          aria-activedescendant={shown[idx] ? `${uid}-${idx}` : undefined}
          value={query}
          placeholder={searchPlaceholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          className="mb-1 h-[var(--control-sm)] w-full rounded-sm border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <div
          id={`${uid}-list`}
          role="listbox"
          data-slot="combobox-list"
          className="max-h-60 overflow-y-auto"
        >
          {shown.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</div>
          )}
          {shown.map((o, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: bàn phím đi qua ô tìm (aria-activedescendant)
            <div
              key={o.value}
              id={`${uid}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={o.value === value}
              data-active={i === idx || undefined}
              data-slot="combobox-option"
              onMouseMove={() => setActive(i)}
              onClick={() => pick(o)}
              className="cursor-default rounded-sm px-2 py-1.5 text-sm data-[active]:bg-accent data-[active]:text-accent-foreground"
            >
              {o.label}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
