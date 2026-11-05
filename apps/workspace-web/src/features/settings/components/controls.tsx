import { cn } from "~/lib/utils";

export const FIELD =
  "h-10 w-full rounded-lg border border-field bg-panel px-3 text-body outline-none focus-visible:ring-2 focus-visible:ring-act disabled:opacity-60";

export function Num({
  id,
  value,
  onChange,
  min,
  max,
  suffix,
  step = 1,
  className,
  label,
}: {
  id?: string;
  label?: string;
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
        aria-label={label}
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
