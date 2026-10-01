// ADM-FR-20 · bước 3 "Người dùng gõ gì": tham số lệnh (≤ 20, ↑↓), cú pháp xem trước.
import { ARGS_MAX } from "@ai/contracts";
import { useCallback } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { CommandFormValues } from "../lib/schemas";
import { ArgRow } from "./ArgRow";
import { StepSection } from "./StepSection";
import { SyntaxPreview } from "./SyntaxPreview";

const NEW_ARG: CommandFormValues["args"][number] = {
  name: "",
  description: { vi: "", en: "" },
  default: "",
  fallback: "none",
  rest: false,
};

export function StepArgs() {
  const { t } = useTranslation();
  const { control } = useFormContext<CommandFormValues>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "args" });
  const name = useWatch({ control, name: "name" });
  const full = fields.length >= ARGS_MAX;
  const onMove = useCallback((from: number, to: number) => move(from, to), [move]);
  const onRemove = useCallback((i: number) => remove(i), [remove]);

  return (
    <StepSection n={3} title={t("commands.step3")}>
      {fields.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("commands.args.empty", { name })}</p>
      ) : (
        <div>
          {fields.map((f, i) => (
            <ArgRow
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
        <Button type="button" variant="outline" disabled={full} onClick={() => append(NEW_ARG)}>
          {t("commands.args.add")}
        </Button>
        {full ? (
          <span className="text-caption text-muted-foreground">{t("commands.args.max")}</span>
        ) : null}
      </div>
      <SyntaxPreview />
    </StepSection>
  );
}
