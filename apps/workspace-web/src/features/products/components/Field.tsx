// gap-d1 · ô nhập dùng chung của các form Sản phẩm & Giá: nhãn + ô (mọi ô có nhãn gắn `htmlFor`).
import { DateInput } from "@ai/web-kit/ui/DateInput";
import type { InputHTMLAttributes } from "react";

export const FIELD =
  "w-full rounded-lg border border-field bg-panel px-3 py-2 text-body outline-none focus-visible:ring-2 focus-visible:ring-act disabled:opacity-60";

export function FieldDate({
  id,
  label,
  value,
  onChange,
  min,
  max,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  min?: string | undefined;
  max?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-label text-ink-2">
        {label}
      </label>
      <DateInput
        id={id}
        data-testid={id}
        inputClassName={FIELD}
        className="w-full"
        value={value}
        onChange={onChange}
        min={min}
        max={max}
      />
    </div>
  );
}

export function Field({
  id,
  label,
  ...rest
}: { id: string; label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-label text-ink-2">
        {label}
      </label>
      <input id={id} data-testid={id} className={FIELD} {...rest} />
    </div>
  );
}
