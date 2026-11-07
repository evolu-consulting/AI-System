// CR-103 · fnr-if (flow-node-registry design §3): khối "Nếu" của node If — chọn AND/OR, tối đa 6 điều kiện (nguồn · phép · giá trị),
// bước Đúng / Sai. Trình bày thuần (không fetch); lỗi theo path server `stages.i.executor.*`. Nối vào StageForm ở đợt wiring.
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { gotoSteps, opsForType } from "../../domain/branch-rules";
import {
  type CondDraft,
  type CondSource,
  condSources,
  emptyCond,
  factSources,
  IF_CONDS_MAX,
  type IfDraft,
  ifErrorAt,
} from "../../lib/if-form";
import { ifSentence } from "../../lib/if-sentence";
import { useStepOptionLabel } from "../../lib/step-options";
import { useFlowCtx } from "../flow/flow-ctx";
import { SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.editor.stage.if.";

export type StageIfProps = {
  /** Tiền tố id phần tử (vd. `stage.uid`). */
  id: string;
  /** Chỉ số stage trong def — để đọc lỗi `stages.<index>.executor.*`. */
  index: number;
  value: IfDraft;
  sources: readonly CondSource[];
  /** Bước đích chọn được, đếm từ 1. */
  steps: readonly number[];
  /** CR-122 · p22 · nhãn ô chọn bước ("Bước N · tên"); số bước đếm từ 1. Vắng ⇒ "Bước N". */
  optLabel?: (step: number) => string;
  errors: Record<string, string>;
  readOnly: boolean;
  onChange: (patch: Partial<IfDraft>) => void;
};

/** Ô giá trị của một điều kiện: Có/Không chọn từ danh sách (không gõ "true"), còn lại là ô nhập theo kiểu. */
function CondValue(p: {
  id: string;
  type: string;
  value: string;
  readOnly: boolean;
  error: string | undefined;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  if (p.type === "boolean")
    return (
      <SelectField
        id={p.id}
        label={t(`${K}value`)}
        value={p.value === "false" ? "false" : "true"}
        readOnly={p.readOnly}
        error={p.error}
        options={[
          { value: "true", label: t("process.admin.flow.yes") },
          { value: "false", label: t("process.admin.flow.no") },
        ]}
        onChange={p.onChange}
      />
    );
  return (
    <TextField
      id={p.id}
      label={t(`${K}value`)}
      type={p.type === "number" ? "number" : p.type === "date" ? "date" : "text"}
      value={p.value}
      readOnly={p.readOnly}
      error={p.error}
      onChange={p.onChange}
    />
  );
}
export function StageIf(p: StageIfProps) {
  const { t } = useTranslation();
  const { id, index, value, sources, steps, errors, readOnly } = p;
  const err = (cell: Parameters<typeof ifErrorAt>[2]) => {
    const k = ifErrorAt(errors, index, cell);
    return k ? t(k) : undefined;
  };
  const setCond = (j: number, patch: Partial<CondDraft>) =>
    p.onChange({ conds: value.conds.map((c, k) => (k === j ? { ...c, ...patch } : c)) });
  const full = value.conds.length >= IF_CONDS_MAX;
  const stepOpts = steps.map((s) => ({
    value: String(s),
    label: p.optLabel?.(s) ?? t(`${K}stepOpt`, { n: s }),
  }));
  const groupErr = err(undefined);
  const stepName = (s: number | null) =>
    s === null ? null : (p.optLabel?.(s) ?? t(`${K}stepOpt`, { n: s }));
  const sentence = ifSentence({
    join: value.op,
    conds: value.conds.map((c) => ({
      ...c,
      bool: sources.find((s) => s.value === c.from)?.type === "boolean",
    })),
    fromLabel: (c) => sources.find((s) => s.value === c.from)?.label ?? c.from,
    yes: stepName(value.yes),
    no: stepName(value.no),
    words: {
      if: t(`${K}s.if`),
      and: t(`${K}s.and`),
      or: t(`${K}s.or`),
      goTo: t(`${K}s.goTo`),
      otherwise: t(`${K}s.otherwise`),
      nextStep: t(`${K}nextStep`),
      blank: t(`${K}s.blank`),
      million: t(`${K}s.million`),
      billion: t(`${K}s.billion`),
      bool: {
        is: t(`${K}opIs`),
        isNot: t(`${K}opIsNot`),
        yes: t("process.admin.flow.yes"),
        no: t("process.admin.flow.no"),
      },
      ops: Object.fromEntries(
        ["eq", "ne", "lt", "le", "gt", "ge"].map((o) => [
          o,
          t(`process.admin.editor.stage.branch.ops.${o}`),
        ]),
      ),
    },
  });
  return (
    <fieldset
      aria-label={t(`${K}title`)}
      disabled={readOnly}
      className="space-y-3"
      data-testid="stage-if"
    >
      <strong className="text-label font-medium" title={t("process.admin.flow.ifHint")}>
        {t(`${K}title`)}
      </strong>
      {sources.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t(`${K}noSources`)}</p>
      ) : null}
      {sentence ? (
        <p
          className="m-0 rounded-md bg-muted/50 px-3 py-2 text-body"
          data-testid="if-sentence"
          aria-live="polite"
        >
          {sentence}
        </p>
      ) : null}
      {value.conds.length > 1 ? (
        <SelectField
          id={`${id}-if-op`}
          label={t(`${K}join`)}
          value={value.op}
          readOnly={readOnly}
          options={[
            { value: "and", label: t(`${K}and`) },
            { value: "or", label: t(`${K}or`) },
          ]}
          onChange={(op) => p.onChange({ op: op === "or" ? "or" : "and" })}
        />
      ) : null}
      {value.conds.map((c, j) => {
        const type = sources.find((s) => s.value === c.from)?.type ?? "string";
        const cell = (k: "from" | "op" | "value") => err(`when.conds.${j}.${k}`);
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: điều kiện không có danh tính ổn định
            key={j}
            className="grid gap-2 rounded-md border border-border p-2.5 sm:grid-cols-2"
            data-testid={`if-cond-${j + 1}`}
          >
            <SelectField
              id={`${id}-c${j}-from`}
              label={t(`${K}from`)}
              value={c.from}
              readOnly={readOnly}
              error={cell("from")}
              placeholder={t(`${K}fromPh`)}
              options={sources.map((s) => ({
                value: s.value,
                label: s.label,
              }))}
              onChange={(from) => {
                const ft = sources.find((s) => s.value === from)?.type ?? "string";
                const op = opsForType(ft).includes(c.op as never) ? c.op : "eq";
                setCond(j, {
                  from,
                  type: ft,
                  op,
                  ...(ft === type ? {} : { value: ft === "boolean" ? "true" : "" }),
                });
              }}
            />
            <SelectField
              id={`${id}-c${j}-op`}
              label={t(`${K}op`)}
              value={c.op}
              readOnly={readOnly}
              error={cell("op")}
              options={opsForType(type).map((o) => ({
                value: o,
                label:
                  type === "boolean"
                    ? t(`${K}${o === "eq" ? "opIs" : "opIsNot"}`)
                    : t(`process.admin.editor.stage.branch.ops.${o}`),
              }))}
              onChange={(op) => setCond(j, { op })}
            />
            <div className="sm:col-span-2">
              <CondValue
                id={`${id}-c${j}-value`}
                type={type}
                value={c.value}
                readOnly={readOnly}
                error={cell("value")}
                onChange={(v) => setCond(j, { value: v })}
              />
            </div>
            {readOnly || value.conds.length <= 1 ? null : (
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t(`${K}remove`, { n: j + 1 })}
                  onClick={() => p.onChange({ conds: value.conds.filter((_, k) => k !== j) })}
                >
                  <X aria-hidden className="size-4" />
                  {t(`${K}delete`)}
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {readOnly ? null : full ? (
        <p className="text-caption text-muted-foreground">{t(`${K}max`)}</p>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => p.onChange({ conds: [...value.conds, emptyCond()] })}
        >
          <Plus aria-hidden className="size-4" />
          {t(`${K}add`)}
        </Button>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField
          id={`${id}-if-yes`}
          label={t(`${K}yes`)}
          value={value.yes === null ? "" : String(value.yes)}
          readOnly={readOnly}
          error={err("then_step")}
          placeholder={t(`${K}stepPh`)}
          options={stepOpts}
          onChange={(v) => p.onChange({ yes: Number(v) })}
        />
        <SelectField
          id={`${id}-if-no`}
          label={t(`${K}no`)}
          value={value.no === null ? "" : String(value.no)}
          readOnly={readOnly}
          error={err("else_step")}
          placeholder={t(`${K}nextStep`)}
          options={[{ value: "", label: t(`${K}nextStep`) }, ...stepOpts]}
          onChange={(v) => p.onChange({ no: v === "" ? null : Number(v) })}
        />
      </div>
      {groupErr ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{groupErr}</AlertDescription>
        </Alert>
      ) : null}
    </fieldset>
  );
}

/** Nối `StageIf` vào `StageForm`: nguồn = field stage bước nhỏ hơn + input khai báo; đích = bước sau (đếm từ 1). */
export function StageIfForm(p: StageFormProps) {
  const { stage, index, all, defInputs, errors, readOnly, onChange } = p;
  const label = useStepOptionLabel(all);
  return (
    <StageIf
      id={stage.uid}
      index={index}
      value={stage.ifx}
      sources={[
        ...factSources(useFlowCtx()?.event?.facts ?? []),
        ...condSources(all, defInputs ?? [], stage.step),
      ]}
      steps={gotoSteps(all, stage.step).map((s) => s + 1)}
      optLabel={(s) => label(s - 1)}
      errors={errors}
      readOnly={readOnly}
      onChange={(patch) => onChange({ ifx: { ...stage.ifx, ...patch } })}
    />
  );
}
