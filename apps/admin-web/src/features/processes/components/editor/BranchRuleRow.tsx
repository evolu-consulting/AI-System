// ADM-FR-71 · HUB-FR-147 · AC-H45 · P-d2 (plan-frontend-d2 §10; mockup 04 E3): một luật rẽ nhánh — Nếu trường · Phép so sánh · Giá trị ·
// Thì tới bước · Xoá. Trình bày thuần (không fetch); kiểu ô giá trị theo kiểu trường.
import { X } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { type BranchOp, opsForType } from "../../domain/branch-rules";
import type { BranchDraft, FieldDraft } from "../../lib/draft-types";
import { SelectField, TextField } from "./Fields";

const K = "process.admin.editor.stage.branch.";
export type CellErrors = Partial<Record<"field" | "op" | "value" | "goto_step", string>>;

export type BranchRuleRowProps = {
  id: string;
  n: number;
  rule: BranchDraft;
  fields: readonly FieldDraft[];
  steps: readonly number[];
  readOnly: boolean;
  errors: CellErrors;
  onChange: (patch: Partial<BranchDraft>) => void;
  onRemove: () => void;
};

function BranchRuleRowImpl(p: BranchRuleRowProps) {
  const { t } = useTranslation();
  const { id, n, rule, fields, readOnly, errors } = p;
  const type = fields.find((f) => f.key === rule.field)?.type ?? "string";
  const msg = (k: string | undefined) => (k ? t(k, { n }) : undefined);
  return (
    <div
      className="grid gap-2 rounded-md border border-border p-2.5 sm:grid-cols-2"
      data-testid={`branch-rule-${n}`}
    >
      <SelectField
        id={`${id}-field`}
        label={t(`${K}field`)}
        value={rule.field}
        readOnly={readOnly}
        error={msg(errors.field)}
        options={fields.map((f) => ({
          value: f.key,
          label: `${f.key} (${t(`process.admin.editor.stage.type.${f.type}`)})`,
        }))}
        onChange={(field) => {
          const ft = fields.find((f) => f.key === field)?.type ?? "string";
          const op = opsForType(ft).includes(rule.op as BranchOp) ? rule.op : "eq";
          p.onChange({ field, op, ...(ft === type ? {} : { value: "" }) });
        }}
      />
      <SelectField
        id={`${id}-op`}
        label={t(`${K}op`)}
        value={rule.op}
        readOnly={readOnly}
        error={msg(errors.op)}
        options={opsForType(type).map((o) => ({ value: o, label: t(`${K}ops.${o}`) }))}
        onChange={(op) => p.onChange({ op })}
      />
      <TextField
        id={`${id}-value`}
        label={t(`${K}value`)}
        type={type === "number" ? "number" : type === "date" ? "date" : "text"}
        value={rule.value}
        readOnly={readOnly}
        error={msg(errors.value)}
        onChange={(value) => p.onChange({ value })}
      />
      <SelectField
        id={`${id}-goto`}
        label={t(`${K}goto`)}
        value={rule.goto === null ? "" : String(rule.goto)}
        readOnly={readOnly}
        error={msg(errors.goto_step)}
        placeholder={t(`${K}gotoPh`)}
        options={p.steps.map((s) => ({ value: String(s), label: t(`${K}gotoOpt`, { n: s }) }))}
        onChange={(v) => p.onChange({ goto: Number(v) })}
      />
      {readOnly ? null : (
        <div className="sm:col-span-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t(`${K}remove`, { n })}
            onClick={p.onRemove}
          >
            <X aria-hidden className="size-4" />
            {t(`${K}delete`)}
          </Button>
        </div>
      )}
    </div>
  );
}

export const BranchRuleRow = memo(BranchRuleRowImpl);
