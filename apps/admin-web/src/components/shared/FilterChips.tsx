// ADM-FR-60, ADM-FR-04 · chip lọc chọn một: `radiogroup` + `radio` (có số tuỳ chọn), mũi tên di chuyển.
import { type KeyboardEvent, useRef } from "react";
import { cn } from "@/lib/utils";

export type Chip<V extends string> = { value: V; label: string; count?: number };

type Props<V extends string> = {
  label: string;
  chips: Chip<V>[];
  value: V;
  onChange: (value: V) => void;
};

export function FilterChips<V extends string>({ label, chips, value, onChange }: Props<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + chips.length) % chips.length;
    const chip = chips[next];
    if (!chip) return;
    onChange(chip.value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
      {chips.map((chip, i) => {
        const checked = chip.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: nhãn e2e yêu cầu role "radio" cho chip; <input type=radio> ẩn sẽ mất kiểu dáng chip
          <button
            key={chip.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(chip.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-label font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              checked
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border bg-card text-muted-strong-foreground hover:bg-muted",
            )}
          >
            <span>{chip.label}</span>
            {chip.count === undefined ? null : (
              <span className="text-caption text-muted-foreground">{chip.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
