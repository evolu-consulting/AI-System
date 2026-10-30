// CR-105 · L3: điều kiện áp dụng của một bước Form — loại HĐ (nhiều) AND/OR giá trị (≥ > ≤ <). Chuyển từ contracts-web `FlowWhen`.
import type { FlowWhen } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildWhen, DEALS, VALUE_OPS, type ValueOp, whenParts } from "../../lib/flow-when";
import type { DealKind } from "../../library-api";

type Props = {
  id: string;
  when: FlowWhen | null;
  onChange: (w: FlowWhen | null) => void;
  error?: string;
};

export function FlowWhenEditor({ id, when, onChange, error }: Props) {
  const { t } = useTranslation();
  const f = (k: string) => t(`process.admin.library.form.${k}`);
  if (!when)
    return (
      <div className="flex items-center gap-3">
        <span className="text-body text-muted-foreground">{f("always")}</span>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => onChange({ op: "and", conds: [] })}
        >
          {f("addCond")}
        </Button>
      </div>
    );
  const { deal, value } = whenParts(when);
  const set = (d: readonly DealKind[], v: typeof value, op = when.op) =>
    onChange(buildWhen(op, d, v));
  return (
    <fieldset className="min-w-0 space-y-2 border-0 p-0">
      <legend className="sr-only">{f("cond")}</legend>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-caption text-muted-foreground">{f("dealKind")}</span>
        {DEALS.map((d) => (
          <Label key={d} className="flex items-center gap-1.5 font-normal">
            <Checkbox
              checked={deal.includes(d)}
              onCheckedChange={() =>
                set(deal.includes(d) ? deal.filter((x) => x !== d) : [...deal, d], value)
              }
            />
            {f(`deal.${d}`)}
          </Label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Label className="flex items-center gap-1.5 font-normal">
          <Checkbox
            checked={!!value}
            onCheckedChange={(c) => set(deal, c === true ? { op: "ge", value: 0 } : null)}
          />
          {f("valueCond")}
        </Label>
        {value ? (
          <>
            <Select
              value={value.op}
              onValueChange={(o) => set(deal, { ...value, op: o as ValueOp })}
            >
              <SelectTrigger aria-label={f("cmp")} className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALUE_OPS.map(([o, label]) => (
                  <SelectItem key={o} value={o}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              id={`${id}-amount`}
              type="number"
              min={0}
              aria-label={f("amount")}
              className="w-44"
              value={value.value}
              onChange={(e) => set(deal, { ...value, value: Math.trunc(Number(e.target.value)) })}
            />
          </>
        ) : null}
      </div>
      {deal.length > 0 && value ? (
        <div className="flex items-center gap-3">
          <span className="text-caption text-muted-foreground">{f("op")}</span>
          {(["and", "or"] as const).map((o) => (
            <Button
              key={o}
              type="button"
              size="sm"
              variant={when.op === o ? "default" : "outline"}
              aria-pressed={when.op === o}
              onClick={() => set(deal, value, o)}
            >
              {f(o === "and" ? "opAnd" : "opOr")}
            </Button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="link" size="sm" onClick={() => onChange(null)}>
        {f("clearCond")}
      </Button>
    </fieldset>
  );
}
