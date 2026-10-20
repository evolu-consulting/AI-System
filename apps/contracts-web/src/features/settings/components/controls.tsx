// V2-L · ô điều khiển dùng chung của hộp thoại Cài đặt (theo mockup NITI: `.setrow`, `.seg`, `.sw`, `.pct`). Chỉ trình bày.
import type { ReactNode } from "react";
import { SegButton } from "~/components/shared/seg-button";
import { cn } from "~/lib/utils";

export const FIELD =
  "h-10 w-full rounded-lg border border-field bg-panel px-3 text-body outline-none focus-visible:ring-2 focus-visible:ring-act disabled:opacity-60";

export function Panel({
  title,
  sub,
  action,
  children,
}: {
  title?: string;
  sub?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-rule bg-panel">
      {title && (
        <header className="flex items-center gap-3 border-b border-rule-soft bg-sunk px-5 py-3">
          <h3 className="text-label font-semibold">{title}</h3>
          {sub && <span className="text-caption text-dim">{sub}</span>}
          {action && <span className="ml-auto">{action}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Row({
  label,
  htmlFor,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-4 border-t border-rule-soft px-5 py-3.5 first:border-t-0 max-md:grid-cols-1 max-md:gap-2">
      <label htmlFor={htmlFor} className="text-label text-ink-2">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60",
        checked ? "bg-act" : "bg-field",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-panel transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <span
      role="radiogroup"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-full border border-field bg-panel"
    >
      {options.map(([v, text]) => (
        <SegButton
          key={String(v)}
          checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "px-3.5 py-1.5 text-[12.5px]",
            value === v ? "bg-act-soft font-semibold text-act" : "text-ink-2",
          )}
        >
          {text}
        </SegButton>
      ))}
    </span>
  );
}

export function Num({
  id,
  value,
  onChange,
  min,
  max,
  suffix,
  step = 1,
  className,
}: {
  id?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
  step?: number;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex items-center", className)}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        className={cn(FIELD, "tabular-nums", suffix && "pr-14")}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 text-caption text-dim">{suffix}</span>
      )}
    </span>
  );
}

/** Chấm cam: đã khác mặc định. */
export const Dot = ({ label }: { label: string }) => (
  <i
    role="img"
    aria-label={label}
    title={label}
    data-testid="changed-dot"
    className="ml-1.5 inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-orange-500 align-middle"
  />
);
