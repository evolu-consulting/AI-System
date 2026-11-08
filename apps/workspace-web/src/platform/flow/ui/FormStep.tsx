// CR-118 · UW-FR-12 · cr118-flow-web · renderer bước `form`: hiển thị + (người có task đang mở) điền và gửi qua
// `POST /review-tasks/:id/form`. Nhãn/gợi ý render dạng TEXT (React escape) — không HTML. Lỗi sớm theo cùng giới hạn Hub
// (`flowFormValuesSchema`); Hub vẫn kiểm lại theo snapshot (422 FORM_VALUES_INVALID ⇒ gắn lỗi vào trường).

import type { FlowFormField } from "@ai/contracts/flow";
import { DateInput } from "@ai/web-kit/ui/DateInput";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { checkForm, emptyDraft, type FieldErrors, type FormDraft } from "../lib/form-values";
import { StepFrame } from "./StepRow";
import { FlowFormError, type StepProps } from "./types";

const INPUT = "w-full rounded-lg border border-line bg-transparent p-2 text-sm";

function Input({
  f,
  id,
  value,
  onChange,
}: {
  f: FlowFormField;
  id: string;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const str = typeof value === "string" ? value : "";
  switch (f.type) {
    case "textarea":
      return (
        <textarea
          id={id}
          className={INPUT}
          rows={3}
          maxLength={f.max_len}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "checkbox":
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "select":
      return (
        <select id={id} className={INPUT} value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="" />
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "date":
      return (
        <DateInput
          id={id}
          inputClassName={INPUT}
          className="w-full"
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
    case "money":
      return (
        <input
          id={id}
          inputMode={f.type === "money" || f.integer ? "numeric" : "decimal"}
          className={INPUT}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "text":
      return (
        <input
          id={id}
          className={INPUT}
          maxLength={f.max_len}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "file_ref":
      return (
        <input
          id={id}
          className={INPUT}
          value={str}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export default function FormStep({ step, ctx }: StepProps<"form">) {
  const { t } = useTranslation();
  const task = step.status === "open" ? ctx.taskOf(step.key) : null;
  const fillable = task !== null && ctx.submitForm !== undefined;
  const [draft, setDraft] = useState<FormDraft>(() => emptyDraft(step.form));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  const submit = async () => {
    if (!task || !ctx.submitForm || busy) return;
    const check = checkForm(step.form, draft);
    setFail(null);
    if (!check.ok) return setErrors(check.errors);
    setErrors({});
    setBusy(true);
    try {
      await ctx.submitForm(task.task_id, check.values);
    } catch (e) {
      if (e instanceof FlowFormError)
        setErrors(Object.fromEntries(e.paths.map((k) => [k, "invalid" as const])));
      else setFail(t("contracts.flowPanel.form.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame step={step} now={ctx.now}>
      {fillable && (
        <form
          data-flow="form"
          noValidate
          className="mt-2 space-y-3 rounded-xl border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {step.form.fields.map((f) => {
            const id = `flow-${step.key}-${f.key}`;
            const err = errors[f.key];
            return (
              <div key={f.key} data-flow-field={f.key} className="space-y-1">
                <label className="block text-sm font-medium" htmlFor={id}>
                  {f.label}
                  {f.required ? <span aria-hidden="true"> *</span> : null}
                </label>
                <Input
                  f={f}
                  id={id}
                  value={draft[f.key]}
                  onChange={(v) => {
                    setDraft((d) => ({ ...d, [f.key]: v }));
                    setErrors((x) => ({ ...x, [f.key]: undefined }) as FieldErrors);
                  }}
                />
                {f.help ? <p className="text-caption text-dim">{f.help}</p> : null}
                {err ? (
                  <p role="alert" className="text-caption text-late">
                    {t(`contracts.flowPanel.form.error.${err}`)}
                  </p>
                ) : null}
              </div>
            );
          })}
          {fail ? (
            <p role="alert" className="text-sm text-late">
              {fail}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t("contracts.flowPanel.form.submit")}
          </button>
        </form>
      )}
    </StepFrame>
  );
}
