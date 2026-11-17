// CR-181 · s5 · các nhóm lựa chọn của form «Định dạng chữ ký nội bộ» (checkbox nhiều lựa chọn · radio một lựa chọn). Trình bày thuần.
import { Checkbox } from "@ai/web-kit/ui/kit/checkbox";
import { Label } from "@ai/web-kit/ui/kit/label";
import { RadioGroup, RadioGroupItem } from "@ai/web-kit/ui/kit/radio-group";
import type { ReactNode } from "react";

export function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="mb-4 min-w-0 border-0 p-0">
      <legend className="mb-2 text-label font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">{children}</div>
    </fieldset>
  );
}

export function Check({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 max-sm:min-h-11">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

export function Radios<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(v) => onChange(v as T)}
      className="flex flex-wrap gap-x-5 gap-y-2"
    >
      {options.map(([v, text]) => (
        <div key={v} className="flex items-center gap-2 max-sm:min-h-11">
          <RadioGroupItem id={`sig-${id}-${v}`} value={v} />
          <Label htmlFor={`sig-${id}-${v}`}>{text}</Label>
        </div>
      ))}
    </RadioGroup>
  );
}
