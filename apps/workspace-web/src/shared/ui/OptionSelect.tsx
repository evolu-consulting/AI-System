// CR-177 W2 · Ô chọn danh sách ngắn: vỏ mỏng trên `Select` của kit, nhận `<option>` làm con cho dễ chuyển từ select gốc.
// Radix không cho giá trị rỗng ⇒ giá trị "" đi qua một mã tạm (EMPTY) rồi đổi ngược; `onValueChange` luôn nhận "" như cũ.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai/web-kit/ui/kit/select";
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";

const EMPTY = "__empty__";

type Opt = { value: string; label: ReactNode; disabled?: boolean };
type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };

const textOf = (n: ReactNode): string =>
  typeof n === "string" || typeof n === "number"
    ? String(n)
    : Array.isArray(n)
      ? n.map(textOf).join("")
      : "";

/** Gom các `<option>` (kể cả trong Fragment/mảng) thành danh sách. */
function collect(children: ReactNode, out: Opt[] = []): Opt[] {
  for (const c of Children.toArray(children)) {
    if (!isValidElement(c)) continue;
    const el = c as ReactElement<OptionProps & { children?: ReactNode }>;
    if (el.type === Fragment) collect(el.props.children, out);
    else if (el.type === "option")
      out.push({
        value: String(el.props.value ?? textOf(el.props.children)),
        label: el.props.children,
        disabled: el.props.disabled,
      });
  }
  return out;
}

export type OptionSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  id?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "data-testid"?: string;
};

export function OptionSelect({
  value,
  onValueChange,
  children,
  placeholder,
  disabled,
  ...trigger
}: OptionSelectProps) {
  const opts = collect(children);
  const key = (v: string) => (v === "" ? EMPTY : v);
  const hasValue = value !== "" || opts.some((o) => o.value === "");
  return (
    <Select
      value={hasValue ? key(value) : undefined}
      onValueChange={(v) => onValueChange(v === EMPTY ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger data-value={value} {...trigger}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {opts.map((o) => (
          <SelectItem key={o.value} value={key(o.value)} disabled={o.disabled} data-value={o.value}>
            {o.label || " "}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
