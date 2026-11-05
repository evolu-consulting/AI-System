// CR-121 D-3: trình dựng điều kiện "Chỉ chạy khi" của một bước — chọn trường của app (theo `fields` của khe), toán tử theo kiểu,
// giá trị; nhiều điều kiện ghép và/hoặc, nhóm lồng MỘT cấp; trống = "Luôn chạy". Thay FlowWhenEditor cũ (loại HĐ + giá trị cố định).

import type { SlotFieldDto } from "@ai/contracts/hub-admin";
import { type FlowWhen, isFlowCondGroup } from "@ai/contracts/pack-contracts";
import { Group } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type Combiner,
  DEFAULT_FIELDS,
  whenAdd,
  whenGroup,
  whenPatch,
  whenRemove,
  whenSetOp,
} from "../../lib/flow-when";
import { FlowCondRow } from "./FlowCondRow";
import type { GroupOption } from "./flow-step-props";

type Props = {
  id: string;
  when: FlowWhen | null;
  onChange: (w: FlowWhen | null) => void;
  error?: string | undefined;
  fields?: readonly SlotFieldDto[];
  groups?: readonly GroupOption[];
};

function OpToggle(p: { value: Combiner; onChange: (o: Combiner) => void; label: string }) {
  const { t } = useTranslation();
  return (
    <fieldset className="m-0 flex items-center gap-1 border-0 p-0">
      <legend className="sr-only">{p.label}</legend>
      {(["and", "or"] as const).map((o) => (
        <Button
          key={o}
          type="button"
          size="sm"
          variant={p.value === o ? "default" : "outline"}
          aria-pressed={p.value === o}
          onClick={() => p.onChange(o)}
        >
          {t(`process.admin.library.form.${o === "and" ? "opAnd" : "opOr"}`)}
        </Button>
      ))}
    </fieldset>
  );
}

function AddCond(p: {
  label: string;
  fields: readonly SlotFieldDto[];
  onPick: (f: SlotFieldDto) => void;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <Select
      value=""
      onValueChange={(k) => {
        const f = p.fields.find((x) => x.key === k);
        if (f) p.onPick(f);
      }}
    >
      <SelectTrigger aria-label={p.label} data-testid={p.testId} className="w-52">
        <SelectValue placeholder={p.label} />
      </SelectTrigger>
      <SelectContent>
        {p.fields.map((x) => (
          <SelectItem key={x.key} value={x.key}>
            {t(`process.admin.library.form.field.${x.key}`, { defaultValue: x.label })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FlowWhenEditor({ id, when, onChange, error, fields, groups = [] }: Props) {
  const { t } = useTranslation();
  const f = (k: string) => t(`process.admin.library.form.${k}`);
  const list = fields && fields.length > 0 ? fields : DEFAULT_FIELDS;
  if (!when)
    return (
      <div className="flex flex-wrap items-center gap-3" data-testid={`${id}-when`}>
        <span className="text-body text-muted-foreground">{f("always")}</span>
        <AddCond
          label={f("addCond")}
          fields={list}
          testId={`${id}-add`}
          onPick={(x) => onChange(whenAdd(null, x))}
        />
      </div>
    );
  const rowOf = (
    c: Parameters<typeof FlowCondRow>[0]["cond"],
    key: string,
    path: readonly [number] | readonly [number, number],
  ) => (
    <FlowCondRow
      key={key}
      id={`${id}-c${path.join("-")}`}
      cond={c}
      fields={list}
      groups={groups}
      onChange={(n) => onChange(whenPatch(when, path, n))}
      onRemove={() => onChange(whenRemove(when, path))}
    />
  );
  return (
    <fieldset className="min-w-0 space-y-2 border-0 p-0" data-testid={`${id}-when`}>
      <legend className="sr-only">{f("cond")}</legend>
      {when.conds.length > 1 ? (
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted-foreground">{f("op")}</span>
          <OpToggle
            label={f("op")}
            value={when.op}
            onChange={(o) => onChange(whenSetOp(when, o))}
          />
        </div>
      ) : null}
      {when.conds.map((c, i) =>
        isFlowCondGroup(c) ? (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: nhóm không có khoá riêng, thứ tự là danh tính
            key={`g${i}`}
            className="space-y-2 rounded-md border border-dashed border-border p-2"
            data-testid={`${id}-group${i}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-caption text-muted-foreground">{f("groupOp")}</span>
              <OpToggle
                label={f("groupOp")}
                value={c.op}
                onChange={(o) => onChange(whenSetOp(when, o, i))}
              />
            </div>
            {c.conds.map((x, j) => rowOf(x, `g${i}c${j}`, [i, j]))}
            <AddCond
              label={f("addToGroup")}
              fields={list}
              testId={`${id}-group${i}-add`}
              onPick={(x) => onChange(whenAdd(when, x, i))}
            />
          </div>
        ) : (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: điều kiện lá không có khoá riêng
            key={`c${i}`}
            className="flex flex-wrap items-center gap-1"
          >
            {rowOf(c, `c${i}`, [i])}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={f("toGroup")}
              title={f("toGroup")}
              onClick={() => onChange(whenGroup(when, i))}
            >
              <Group aria-hidden className="size-4" />
            </Button>
          </div>
        ),
      )}
      <div className="flex flex-wrap items-center gap-3">
        <AddCond
          label={f("addCond")}
          fields={list}
          testId={`${id}-add`}
          onPick={(x) => onChange(whenAdd(when, x))}
        />
        <Button type="button" variant="link" size="sm" onClick={() => onChange(null)}>
          {f("clearCond")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
