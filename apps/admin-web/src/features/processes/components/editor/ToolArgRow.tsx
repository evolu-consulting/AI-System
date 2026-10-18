// ADM-FR-71 · HUB-FR-146 · AC-H44 · P-d2 (plan-frontend-d2 §10; mockup 04 E1/E2): một thẻ tham số tool — tên mono + bắt buộc + kiểu +
// mô tả, chọn nguồn (giá trị cố định / đầu vào / kết quả giai đoạn trước) rồi giá trị. Trình bày thuần (không fetch).
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ArgSourceOption, ParamShape } from "../../domain/tool-rules";
import type { ArgDraft } from "../../lib/draft-types";

const K = "process.admin.editor.stage.tool.";
const FROMS = ["const", "input", "field"] as const;

export type ToolArgRowProps = {
  param: ParamShape & { description?: string };
  arg: ArgDraft | undefined;
  inputs: readonly ArgSourceOption[];
  fields: readonly ArgSourceOption[];
  readOnly: boolean;
  error: string | undefined;
  onChange: (patch: Partial<ArgDraft>) => void;
};

type Item = { value: string; label: string };

function Pick(p: {
  label: string;
  value: string;
  items: readonly Item[];
  readOnly: boolean;
  onChange: (v: string) => void;
  max?: string;
  invalid?: boolean;
}) {
  return (
    <Select value={p.value} onValueChange={p.onChange} disabled={p.readOnly}>
      <SelectTrigger
        aria-label={p.label}
        aria-invalid={p.invalid || undefined}
        className={`h-8 min-w-0 flex-1 ${p.max ?? ""}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {p.items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const kindOf = (type: string): ArgDraft["kind"] =>
  type === "number" ? "number" : type === "boolean" ? "boolean" : "string";

/** Ô giá trị theo nguồn: cố định (chọn / số / chữ), đầu vào, kết quả giai đoạn trước. */
function ArgValue(p: ToolArgRowProps & { from: ArgDraft["from"]; value: string }) {
  const { t } = useTranslation();
  const { param, from, value, readOnly, onChange } = p;
  const label = t(`${K}argValue`, { name: param.name });
  const kind = kindOf(param.type);
  if (from === "const") {
    const choice: Item[] =
      param.type === "boolean"
        ? [
            { value: "true", label: t(`${K}bool.true`) },
            { value: "false", label: t(`${K}bool.false`) },
          ]
        : (param.options ?? []).map((o) => ({ value: o, label: o }));
    if (choice.length > 0)
      return (
        <Pick
          label={label}
          value={value}
          items={choice}
          readOnly={readOnly}
          onChange={(v) => onChange({ value: v, kind })}
        />
      );
    return (
      <Input
        aria-label={label}
        type={param.type === "number" ? "number" : "text"}
        value={value}
        readOnly={readOnly}
        className="h-8 min-w-0 flex-1"
        onChange={(e) => onChange({ value: e.target.value, kind })}
      />
    );
  }
  if (from === "") return null;
  const items = (from === "input" ? p.inputs : p.fields).map((o) => ({
    value: o.value,
    label:
      o.kind === "input"
        ? t(`${K}inputOpt`, { key: o.key, label: o.label })
        : t(`${K}fieldOpt`, { n: o.n, field: o.field }),
  }));
  return (
    <Pick
      label={label}
      value={value}
      items={items}
      readOnly={readOnly}
      onChange={(v) => onChange({ value: v })}
    />
  );
}

function ToolArgRowImpl(p: ToolArgRowProps) {
  const { t } = useTranslation();
  const { param, arg, error, readOnly, onChange } = p;
  const from = arg?.from ?? "";
  return (
    <div
      className="space-y-1.5 rounded-md border border-border p-2.5"
      data-testid={`arg-${param.name}`}
    >
      <div className="flex items-center justify-between gap-2">
        <b className="font-mono text-label">
          {param.name}
          {param.required ? (
            <>
              <span aria-hidden className="ml-0.5 text-destructive">
                *
              </span>
              <span className="sr-only">{t(`${K}required`)}</span>
            </>
          ) : null}
        </b>
        <span className="text-caption text-muted-foreground">
          {t(`${K}paramType.${param.type}`, { defaultValue: param.type })}
        </span>
      </div>
      {param.description ? (
        <p className="text-caption text-muted-foreground">{param.description}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Pick
          label={t(`${K}argSource`, { name: param.name })}
          value={from}
          readOnly={readOnly}
          invalid={error !== undefined}
          max="max-w-[11.5rem]"
          items={FROMS.map((f) => ({ value: f, label: t(`${K}from.${f}`) }))}
          onChange={(f) =>
            onChange({ from: f as ArgDraft["from"], value: "", kind: kindOf(param.type) })
          }
        />
        <ArgValue {...p} from={from} value={arg?.value ?? ""} />
      </div>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const ToolArgRow = memo(ToolArgRowImpl);
