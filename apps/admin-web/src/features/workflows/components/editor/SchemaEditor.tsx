// ADM-FR-11 · M2-R08 · tab "Input": bảng tham số nhập tay (≤ 50), thứ tự = thứ tự mảng, `+ Thêm tham số` khoá ở 50.
import { INPUT_SCHEMA_MAX } from "@ai/contracts";
import { useCallback } from "react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { WorkflowFormValues } from "../../lib/schemas";
import { SchemaParamRow } from "./SchemaParamRow";

const NEW_PARAM: WorkflowFormValues["input_schema"][number] = {
  name: "",
  type: "text",
  required: false,
  description: "",
  options: "",
};

export function SchemaEditor() {
  const { t } = useTranslation();
  const { control } = useFormContext<WorkflowFormValues>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "input_schema" });
  const full = fields.length >= INPUT_SCHEMA_MAX;
  const onMove = useCallback((from: number, to: number) => move(from, to), [move]);
  const onRemove = useCallback((i: number) => remove(i), [remove]);

  return (
    <section aria-label={t("workflows.schema.title")} className="space-y-2">
      {fields.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("workflows.schema.empty")}</p>
      ) : (
        <div>
          <div className="hidden gap-2 border-b border-border pb-2 text-caption font-semibold text-muted-foreground md:grid md:grid-cols-[1fr_8rem_5rem_2fr_auto]">
            <span>{t("workflows.schema.col.name")}</span>
            <span>{t("workflows.schema.col.type")}</span>
            <span>{t("workflows.schema.col.required")}</span>
            <span>{t("workflows.schema.col.description")}</span>
            <span className="w-[6.75rem]" />
          </div>
          {fields.map((f, i) => (
            <SchemaParamRow
              key={f.id}
              index={i}
              total={fields.length}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" disabled={full} onClick={() => append(NEW_PARAM)}>
          {t("workflows.schema.add")}
        </Button>
        {full ? (
          <span className="text-caption text-muted-foreground">{t("workflows.schema.max")}</span>
        ) : null}
      </div>
    </section>
  );
}
