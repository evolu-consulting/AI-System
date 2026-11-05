// CR-121 D-3: một dòng điều kiện lá của trình dựng "Chỉ chạy khi": [trường] [toán tử theo kiểu] [giá trị] [xoá].
// Giá trị theo kiểu trường: số tiền (số nguyên VND) / chọn loại (nhiều) / chọn phòng ban theo mã (nhiều) / có-không.
import type { FlowCond } from "@ai/contracts";
import type { SlotFieldDto } from "@ai/contracts/hub-admin";
import { X } from "lucide-react";
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
import { NUM_OPS, newCond, OP_SYMBOL, type ValueOp } from "../../lib/flow-when";
import type { GroupOption } from "./flow-step-props";

type Props = {
  id: string;
  cond: FlowCond;
  fields: readonly SlotFieldDto[];
  groups: readonly GroupOption[];
  onChange: (c: FlowCond) => void;
  onRemove: () => void;
};

/** Chọn nhiều giá trị từ danh sách (loại HĐ / phòng ban); giá trị đã chọn nhưng ngoài danh sách vẫn hiện để bỏ được. */
function MultiPick(p: {
  id: string;
  label: string;
  options: readonly { value: string; label: string }[];
  value: readonly string[];
  onChange: (v: string[]) => void;
}) {
  const all = [
    ...p.options,
    ...p.value
      .filter((v) => !p.options.some((o) => o.value === v))
      .map((v) => ({ value: v, label: v })),
  ];
  const toggle = (v: string) =>
    p.onChange(p.value.includes(v) ? p.value.filter((x) => x !== v) : [...p.value, v]);
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-3 border-0 p-0">
      <legend className="sr-only">{p.label}</legend>
      {all.map((o) => (
        <Label key={o.value} className="flex items-center gap-1.5 font-normal">
          <Checkbox
            data-testid={`${p.id}-opt-${o.value}`}
            checked={p.value.includes(o.value)}
            onCheckedChange={() => toggle(o.value)}
          />
          {o.label}
        </Label>
      ))}
    </fieldset>
  );
}

function CondValue(p: {
  id: string;
  cond: FlowCond;
  field: SlotFieldDto | undefined;
  groups: readonly GroupOption[];
  onChange: (c: FlowCond) => void;
}) {
  const { t } = useTranslation();
  const { id, cond, field, groups, onChange } = p;
  const f = (k: string) => t(`process.admin.library.form.${k}`);
  const fieldLabel = (x: SlotFieldDto) =>
    t(`process.admin.library.form.field.${x.key}`, { defaultValue: x.label });
  const optLabel = (x: SlotFieldDto, v: string, fallback: string) =>
    x.key === "deal"
      ? t(`process.admin.library.form.deal.${v}`, { defaultValue: fallback })
      : fallback;
  return (
    <>
      {"op" in cond ? (
        <>
          <Select value={cond.op} onValueChange={(o) => onChange({ ...cond, op: o as ValueOp })}>
            <SelectTrigger aria-label={f("cmp")} className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NUM_OPS.filter((o) => !field || field.ops.includes(o)).map((o) => (
                <SelectItem key={o} value={o}>
                  {OP_SYMBOL[o]}
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
            value={cond.value}
            onChange={(e) => onChange({ ...cond, value: Math.trunc(Number(e.target.value)) })}
          />
        </>
      ) : "in" in cond && field ? (
        <MultiPick
          id={id}
          label={fieldLabel(field)}
          options={
            field.type === "department"
              ? groups.map((g) => ({ value: g.key, label: g.label ?? g.key }))
              : (field.options ?? []).map((o) => ({
                  value: o.value,
                  label: optLabel(field, o.value, o.label),
                }))
          }
          value={cond.in}
          onChange={(v) => onChange({ ...cond, in: v } as FlowCond)}
        />
      ) : "is" in cond ? (
        <Select
          value={cond.is ? "yes" : "no"}
          onValueChange={(v) => onChange({ ...cond, is: v === "yes" })}
        >
          <SelectTrigger aria-label={f("yesNo")} className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">{f("yes")}</SelectItem>
            <SelectItem value="no">{f("no")}</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
    </>
  );
}

export function FlowCondRow({ id, cond, fields, groups, onChange, onRemove }: Props) {
  const { t } = useTranslation();
  const f = (k: string) => t(`process.admin.library.form.${k}`);
  const field = fields.find((x) => x.key === cond.field);
  const fieldLabel = (x: SlotFieldDto) =>
    t(`process.admin.library.form.field.${x.key}`, { defaultValue: x.label });
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`${id}-row`}>
      <Select
        value={cond.field}
        onValueChange={(k) => {
          const nf = fields.find((x) => x.key === k);
          if (nf && nf.key !== cond.field) onChange(newCond(nf));
        }}
      >
        <SelectTrigger aria-label={f("condField")} className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.map((x) => (
            <SelectItem key={x.key} value={x.key}>
              {fieldLabel(x)}
            </SelectItem>
          ))}
          {field ? null : <SelectItem value={cond.field}>{cond.field}</SelectItem>}
        </SelectContent>
      </Select>
      <CondValue id={id} cond={cond} field={field} groups={groups} onChange={onChange} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={f("removeCond")}
        title={f("removeCond")}
        onClick={onRemove}
      >
        <X aria-hidden className="size-4" />
      </Button>
    </div>
  );
}
