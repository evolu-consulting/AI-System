// CR-122 · U1 · FLOW2-FR-16: MỘT control dựng điều kiện trên dữ kiện của sự kiện — dùng cho Bắt đầu khi và Nếu (Luật gốc 2).
// Mỗi vế một hàng lưới cùng cột: [dữ kiện] [toán tử] [giá trị] [xoá]; nhóm lồng một cấp thụt cùng một mức.
import type { AppFactDecl } from "@ai/contracts/app-manifest";
import type { FactCond, FactOp, FactWhen } from "@ai/contracts/hub-admin";
import { Group, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  canAddGroup,
  canAddOuter,
  type FactPath,
  isGroup,
  newFactCond,
  opsOf,
  type WhenItem,
  whenAdd,
  whenGroup,
  whenPatch,
  whenRemove,
  whenSetOp,
  withOp,
} from "../../lib/fact-when";

type Props = {
  id: string;
  when: FactWhen | null | undefined;
  facts: readonly AppFactDecl[];
  onChange: (w: FactWhen | null) => void;
  disabled?: boolean;
};

export const OP_SYMBOL: Record<FactOp, string> = {
  eq: "=",
  ne: "≠",
  lt: "<",
  le: "≤",
  gt: ">",
  ge: "≥",
  in: "∈",
};
const ROW = "grid grid-cols-[13rem_5rem_minmax(0,1fr)_2rem] items-center gap-2";

function ValueInput(p: {
  cond: FactCond;
  fact: AppFactDecl | undefined;
  onChange: (c: FactCond) => void;
  label: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { cond, fact } = p;
  const v = cond.value;
  if (fact?.type === "boolean")
    return (
      <Select
        value={v === true ? "yes" : "no"}
        disabled={p.disabled}
        onValueChange={(x) => p.onChange({ ...cond, value: x === "yes" })}
      >
        <SelectTrigger aria-label={p.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="yes">{t("process.admin.flow.yes")}</SelectItem>
          <SelectItem value="no">{t("process.admin.flow.no")}</SelectItem>
        </SelectContent>
      </Select>
    );
  if (fact?.type === "enum" && !Array.isArray(v))
    return (
      <Select
        value={String(v)}
        disabled={p.disabled}
        onValueChange={(x) => p.onChange({ ...cond, value: x })}
      >
        <SelectTrigger aria-label={p.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(fact.options ?? []).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  if (Array.isArray(v))
    return (
      <Input
        aria-label={p.label}
        disabled={p.disabled}
        placeholder={t("process.admin.flow.listHint")}
        value={v.join(", ")}
        onChange={(e) =>
          p.onChange({
            ...cond,
            value: e.target.value.split(",").map((x) => x.trim()),
          })
        }
      />
    );
  const num = fact?.type === "number";
  return (
    <Input
      aria-label={p.label}
      disabled={p.disabled}
      type={num ? "number" : fact?.type === "date" ? "date" : "text"}
      value={String(v)}
      onChange={(e) =>
        p.onChange({ ...cond, value: num ? Number(e.target.value) : e.target.value })
      }
    />
  );
}

function CondRow(p: {
  id: string;
  cond: FactCond;
  facts: readonly AppFactDecl[];
  disabled: boolean;
  onChange: (c: FactCond) => void;
  onRemove: () => void;
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const fact = p.facts.find((f) => f.key === p.cond.fact);
  const ops = fact ? opsOf(fact.type) : [p.cond.op];
  return (
    <div className={ROW} data-testid={`${p.id}-row`}>
      <Select
        value={p.cond.fact}
        disabled={p.disabled}
        onValueChange={(k) => {
          const nf = p.facts.find((f) => f.key === k);
          if (nf && nf.key !== p.cond.fact) p.onChange(newFactCond(nf));
        }}
      >
        <SelectTrigger aria-label={t("process.admin.flow.fact")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {p.facts.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={p.cond.op}
        disabled={p.disabled}
        onValueChange={(o) => p.onChange(withOp(p.cond, o as FactOp))}
      >
        <SelectTrigger aria-label={t("process.admin.flow.op")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ops.map((o) => (
            <SelectItem key={o} value={o}>
              {OP_SYMBOL[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ValueInput
        cond={p.cond}
        fact={fact}
        label={t("process.admin.flow.value")}
        disabled={p.disabled}
        onChange={p.onChange}
      />
      <div className="flex items-center justify-end">
        {p.extra}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={p.disabled}
          aria-label={t("process.admin.flow.removeCond")}
          title={t("process.admin.flow.removeCond")}
          onClick={p.onRemove}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function OpToggle(p: { value: "and" | "or"; onChange: (o: "and" | "or") => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="m-0 flex items-center gap-1 border-0 p-0">
      {(["and", "or"] as const).map((o) => (
        <Button
          key={o}
          type="button"
          size="sm"
          variant={p.value === o ? "default" : "outline"}
          aria-pressed={p.value === o}
          onClick={() => p.onChange(o)}
        >
          {t(`process.admin.flow.${o}`)}
        </Button>
      ))}
    </fieldset>
  );
}

export function FactWhenEditor({ id, when, facts, onChange, disabled = false }: Props) {
  const { t } = useTranslation();
  const w = when ?? null;
  const add = (g?: number) => {
    const f = facts[0];
    if (f) onChange(whenAdd(w, f, g));
  };
  const rowOf = (c: FactCond, key: string, path: FactPath, extra?: React.ReactNode) => (
    <CondRow
      key={key}
      id={`${id}-c${path.join("-")}`}
      cond={c}
      facts={facts}
      disabled={disabled}
      extra={extra}
      onChange={(n) => w && onChange(whenPatch(w, path, n))}
      onRemove={() => w && onChange(whenRemove(w, path))}
    />
  );
  return (
    <div className="space-y-2" data-testid={`${id}-when`}>
      {w && w.conds.length > 1 ? (
        <OpToggle value={w.op} onChange={(o) => onChange(whenSetOp(w, o))} />
      ) : null}
      {w ? (
        (w.conds as WhenItem[]).map((c, i) =>
          isGroup(c) ? (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: nhóm không có khoá riêng
              key={`g${i}`}
              className="space-y-2 rounded-md border border-dashed border-border p-2"
            >
              <OpToggle value={c.op} onChange={(o) => onChange(whenSetOp(w, o, i))} />
              {c.conds.map((x, j) => rowOf(x, `g${i}c${j}`, [i, j]))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || !canAddGroup(w, i)}
                onClick={() => add(i)}
              >
                <Plus aria-hidden className="size-4" />
                {t("process.admin.flow.addCond")}
              </Button>
            </div>
          ) : (
            rowOf(
              c,
              `c${i}`,
              [i],
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={t("process.admin.flow.toGroup")}
                title={t("process.admin.flow.toGroup")}
                onClick={() => onChange(whenGroup(w, i))}
              >
                <Group aria-hidden className="size-4" />
              </Button>,
            )
          ),
        )
      ) : (
        <p className="text-body text-muted-foreground">{t("process.admin.flow.always")}</p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`${id}-add`}
        disabled={disabled || facts.length === 0 || !canAddOuter(w)}
        onClick={() => add()}
      >
        <Plus aria-hidden className="size-4" />
        {t("process.admin.flow.addCond")}
      </Button>
    </div>
  );
}
