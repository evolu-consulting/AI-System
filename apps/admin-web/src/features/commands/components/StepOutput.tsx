// ADM-FR-20 · M2-R15 · bước 5 "Hiển thị kết quả": output field, kiểu hiển thị, chế độ sync/async, timeout 1–600 s.
import { COMMAND_MODES, OUTPUT_RENDERS, TIMEOUT_MAX_S, TIMEOUT_MIN_S } from "@ai/contracts";
import { Controller, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTr } from "@/lib/use-translate";
import { defaultTimeout } from "../lib/defaults";
import type { CommandFormValues } from "../lib/schemas";
import { StepSection } from "./StepSection";

export function StepOutput() {
  const { t } = useTranslation();
  const tr = useTr();
  const { register, control, setValue, formState } = useFormContext<CommandFormValues>();
  const { errors, dirtyFields } = formState;
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);

  return (
    <StepSection n={5} title={t("commands.step5")}>
      <FormField
        id="cmd-output"
        label={t("commands.field.outputField")}
        error={msg(errors.output_field?.message)}
      >
        {(p) => (
          <Input
            {...p}
            {...register("output_field")}
            autoComplete="off"
            className="max-w-md font-mono"
          />
        )}
      </FormField>
      <FormField id="cmd-render" label={t("commands.field.render")}>
        {(p) => (
          <Controller
            control={control}
            name="render"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger {...p} className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_RENDERS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`commands.render.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </FormField>
      <FormField id="cmd-mode" label={t("commands.field.mode")}>
        {(p) => (
          <Controller
            control={control}
            name="mode"
            render={({ field }) => (
              <RadioGroup
                {...p}
                aria-label={t("commands.field.mode")}
                value={field.value}
                onValueChange={(v) => {
                  field.onChange(v);
                  // Đổi chế độ → timeout mặc định mới, trừ khi người dùng đã tự sửa timeout.
                  if (!dirtyFields.timeout_s) {
                    setValue("timeout_s", defaultTimeout(v as (typeof COMMAND_MODES)[number]));
                  }
                }}
                className="flex gap-4"
              >
                {COMMAND_MODES.map((m) => (
                  <div key={m} className="flex items-center gap-2">
                    <RadioGroupItem value={m} id={`cmd-mode-${m}`} />
                    <Label htmlFor={`cmd-mode-${m}`} className="font-mono">
                      {m}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          />
        )}
      </FormField>
      <FormField
        id="cmd-timeout"
        label={t("commands.field.timeout")}
        error={msg(errors.timeout_s?.message)}
      >
        {(p) => (
          <Input
            {...p}
            {...register("timeout_s", { valueAsNumber: true })}
            type="number"
            min={TIMEOUT_MIN_S}
            max={TIMEOUT_MAX_S}
            className="w-32"
          />
        )}
      </FormField>
      <div className="flex items-center gap-3">
        <Controller
          control={control}
          name="enabled"
          render={({ field }) => (
            <Switch id="cmd-enabled" checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
        <Label htmlFor="cmd-enabled">{t("commands.field.enabled")}</Label>
      </div>
    </StepSection>
  );
}
