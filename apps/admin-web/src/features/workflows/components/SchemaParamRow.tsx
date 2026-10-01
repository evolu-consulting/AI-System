// ADM-FR-11 · M2-R08 · một dòng tham số input schema: tên (mono) · kiểu · bắt buộc · mô tả · lựa chọn (select) · ↑ ↓ · xoá.
import { INPUT_TYPES } from "@ai/contracts";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { memo } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTr } from "@/lib/use-translate";
import type { WorkflowFormValues } from "../lib/schemas";

type Props = {
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
};

function FieldError({ message }: { message?: string }) {
  const tr = useTr();
  return message ? <p className="mt-1 text-caption text-destructive">{tr(message)}</p> : null;
}

function SchemaParamRowImpl({ index, total, onMove, onRemove }: Props) {
  const { t } = useTranslation();
  const { register, control, formState } = useFormContext<WorkflowFormValues>();
  const type = useWatch({ control, name: `input_schema.${index}.type` });
  const err = formState.errors.input_schema?.[index];
  const n = index + 1;
  return (
    <div className="grid gap-2 border-b border-border py-3 md:grid-cols-[1fr_8rem_5rem_2fr_auto]">
      <div>
        <Input
          {...register(`input_schema.${index}.name`)}
          aria-label={t("workflows.schema.row.name", { n })}
          aria-invalid={err?.name ? true : undefined}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
        <FieldError message={err?.name?.message} />
      </div>
      <Controller
        control={control}
        name={`input_schema.${index}.type`}
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger aria-label={t("workflows.schema.row.type", { n })}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INPUT_TYPES.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <Controller
        control={control}
        name={`input_schema.${index}.required`}
        render={({ field }) => (
          <div className="flex items-center">
            <Checkbox
              checked={field.value}
              onCheckedChange={(v) => field.onChange(v === true)}
              aria-label={t("workflows.schema.row.required", { n })}
            />
          </div>
        )}
      />
      <div className="space-y-2">
        <Input
          {...register(`input_schema.${index}.description`)}
          aria-label={t("workflows.schema.row.description", { n })}
          aria-invalid={err?.description ? true : undefined}
          autoComplete="off"
        />
        <FieldError message={err?.description?.message} />
        {type === "select" ? (
          <>
            <Input
              {...register(`input_schema.${index}.options`)}
              aria-label={t("workflows.schema.row.options", { n })}
              aria-invalid={err?.options ? true : undefined}
              placeholder={t("workflows.schema.optionsHint")}
              autoComplete="off"
            />
            <FieldError message={err?.options?.message} />
          </>
        ) : null}
      </div>
      <div className="flex items-start gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={index === 0}
          aria-label={t("workflows.schema.row.moveUp", { n })}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={index === total - 1}
          aria-label={t("workflows.schema.row.moveDown", { n })}
          onClick={() => onMove(index, index + 1)}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("workflows.schema.row.remove", { n })}
          onClick={() => onRemove(index)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export const SchemaParamRow = memo(SchemaParamRowImpl);
