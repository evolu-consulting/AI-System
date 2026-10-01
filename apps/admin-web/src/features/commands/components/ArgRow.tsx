// ADM-FR-20 · bước 3 · một dòng tham số lệnh: tên · mô tả VI/EN · mặc định · "Nếu trống lấy" · nuốt phần còn lại · ↑ ↓ · xoá.
import { ARG_FALLBACKS } from "@ai/contracts";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { memo } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { LocalizedInput } from "@/components/shared/LocalizedInput";
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
import { useTr } from "@/lib/use-translate";
import type { CommandFormValues } from "../lib/schemas";

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

function ArgRowImpl({ index, total, onMove, onRemove }: Props) {
  const { t } = useTranslation();
  const { register, control, formState } = useFormContext<CommandFormValues>();
  const err = formState.errors.args?.[index];
  const n = index + 1;
  return (
    <div className="space-y-3 border-b border-border py-4 last:border-b-0">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
        <div>
          <Label htmlFor={`arg-name-${index}`} className="mb-1.5">
            {t("commands.args.col.name")}
          </Label>
          <Input
            id={`arg-name-${index}`}
            {...register(`args.${index}.name`)}
            aria-label={t("commands.args.row.name", { n })}
            aria-invalid={err?.name ? true : undefined}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <FieldError message={err?.name?.message} />
        </div>
        <div>
          <Label htmlFor={`arg-default-${index}`} className="mb-1.5">
            {t("commands.args.col.default")}
          </Label>
          <Input
            id={`arg-default-${index}`}
            {...register(`args.${index}.default`)}
            aria-label={t("commands.args.row.default", { n })}
            autoComplete="off"
          />
        </div>
        <div>
          <Label className="mb-1.5">{t("commands.args.col.fallback")}</Label>
          <Controller
            control={control}
            name={`args.${index}.fallback`}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  aria-label={t("commands.args.row.fallback", { n })}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("commands.fallback.none")}</SelectItem>
                  {ARG_FALLBACKS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`commands.fallback.${f}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>
      <Controller
        control={control}
        name={`args.${index}.description`}
        render={({ field }) => (
          <LocalizedInput
            id={`arg-desc-${index}`}
            label={t("commands.args.row.description", { n })}
            value={field.value}
            onChange={field.onChange}
            error={
              err?.description?.vi?.message || err?.description?.en?.message
                ? t("commands.error.descRequired")
                : undefined
            }
          />
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name={`args.${index}.rest`}
              render={({ field }) => (
                <Checkbox
                  id={`arg-rest-${index}`}
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(v === true)}
                  aria-label={t("commands.args.row.rest", { n })}
                />
              )}
            />
            <Label htmlFor={`arg-rest-${index}`}>{t("commands.args.col.rest")}</Label>
          </div>
          <FieldError message={err?.rest?.message} />
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            aria-label={t("commands.args.row.moveUp", { n })}
            onClick={() => onMove(index, index - 1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === total - 1}
            aria-label={t("commands.args.row.moveDown", { n })}
            onClick={() => onMove(index, index + 1)}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("commands.args.row.remove", { n })}
            onClick={() => onRemove(index)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

export const ArgRow = memo(ArgRowImpl);
