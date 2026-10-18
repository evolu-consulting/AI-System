// ADM-FR-66 · CR-056 · P-a F5: ô nhập dùng chung của editor quy trình (nhãn + control + lỗi; nhãn là tên truy cập cho e2e).
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Err = string | undefined;
type Common = {
  id: string;
  label: string;
  error?: Err;
  alert?: boolean;
  readOnly?: boolean;
  description?: string;
};

export function TextField(
  p: Common & {
    value: string;
    onChange: (v: string) => void;
    multiline?: boolean;
    rows?: number;
    type?: "text" | "number" | "time";
    disabled?: boolean;
    /** Id phần tử mô tả thêm (nối vào `aria-describedby`). */
    describedBy?: string;
    prefix?: string;
    mono?: boolean;
    placeholder?: string;
    maxLength?: number;
    min?: number;
    max?: number;
  },
) {
  return (
    <FormField
      id={p.id}
      label={p.label}
      error={p.error}
      alert={p.alert}
      description={p.description}
    >
      {(c) => {
        if (p.multiline) {
          return (
            <Textarea
              {...c}
              value={p.value}
              rows={p.rows ?? 3}
              placeholder={p.placeholder}
              readOnly={p.readOnly}
              maxLength={p.maxLength}
              className={p.mono ? "font-mono" : undefined}
              onChange={(e) => p.onChange(e.target.value)}
            />
          );
        }
        const input = (
          <Input
            {...c}
            aria-describedby={
              [c["aria-describedby"], p.describedBy].filter(Boolean).join(" ") || undefined
            }
            disabled={p.disabled}
            type={p.type ?? "text"}
            placeholder={p.placeholder}
            value={p.value}
            readOnly={p.readOnly}
            maxLength={p.maxLength}
            min={p.min}
            max={p.max}
            className={p.mono ? "font-mono" : undefined}
            onChange={(e) => p.onChange(e.target.value)}
          />
        );
        return p.prefix ? (
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="font-mono text-body text-muted-foreground">
              {p.prefix}
            </span>
            {input}
          </div>
        ) : (
          input
        );
      }}
    </FormField>
  );
}

export type Option = { value: string; label: string };

/** Select Radix: `value=""` ⇒ hiện placeholder. Mục hiện giá trị không còn trong danh sách do nơi gọi thêm vào `options`. */
export function SelectField(
  p: Common & {
    value: string;
    onChange: (v: string) => void;
    options: readonly Option[];
    placeholder?: string;
    disabled?: boolean;
  },
) {
  const { t } = useTranslation();
  return (
    <FormField
      id={p.id}
      label={p.label}
      error={p.error}
      alert={p.alert}
      description={p.description}
    >
      {(c) => (
        <Select value={p.value} onValueChange={p.onChange} disabled={p.disabled || p.readOnly}>
          <SelectTrigger {...c} aria-label={p.label} className="w-full">
            <SelectValue placeholder={p.placeholder ?? t("process.admin.editor.choose")} />
          </SelectTrigger>
          <SelectContent>
            {p.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}
