// ADM-FR-10, ADM-FR-14 · tab "Thông tin": key (khoá sau khi lưu), tên, loại, secret, Base URL, output field, mô tả, công tắc Bật, `side_effect` (X1).
import { APP_TYPES } from "@ai/contracts";
import { Controller, useFormContext, useWatch } from "react-hook-form";
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
import { Textarea } from "@/components/ui/textarea";
import { useTr } from "@/lib/use-translate";
import type { WorkflowFormValues } from "../../lib/schemas";

type Props = {
  mode: "create" | "edit";
  secrets: { id: string; name: string }[] | undefined;
};

export function WorkflowInfoSection({ mode, secrets }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const { register, control, formState } = useFormContext<WorkflowFormValues>();
  const { errors } = formState;
  const desc = useWatch({ control, name: "description" });
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);
  const edit = mode === "edit";

  return (
    <div className="max-w-2xl space-y-4">
      <FormField
        id="wf-key"
        label={t("workflows.field.key")}
        description={edit ? t("workflows.field.keyLocked") : undefined}
        error={msg(errors.key?.message)}
      >
        {(p) => (
          <Input
            {...p}
            {...register("key")}
            readOnly={edit}
            autoComplete="off"
            spellCheck={false}
            className={edit ? "bg-muted font-mono" : "font-mono"}
          />
        )}
      </FormField>
      <FormField id="wf-name" label={t("workflows.field.name")} error={msg(errors.name?.message)}>
        {(p) => <Input {...p} {...register("name")} autoComplete="off" />}
      </FormField>
      <FormField id="wf-type" label={t("workflows.field.type")}>
        {(p) => (
          <Controller
            control={control}
            name="app_type"
            render={({ field }) => (
              <RadioGroup
                {...p}
                aria-label={t("workflows.field.type")}
                value={field.value}
                onValueChange={field.onChange}
                className="flex gap-4"
              >
                {APP_TYPES.map((v) => (
                  <div key={v} className="flex items-center gap-2">
                    <RadioGroupItem value={v} id={`wf-type-${v}`} />
                    <Label htmlFor={`wf-type-${v}`} className="font-mono">
                      {v}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          />
        )}
      </FormField>
      <FormField
        id="wf-secret"
        label={t("workflows.field.secret")}
        error={msg(errors.secret_id?.message)}
      >
        {(p) => (
          <Controller
            control={control}
            name="secret_id"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger {...p} className="w-full font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(secrets ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id} className="font-mono">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </FormField>
      <FormField
        id="wf-base-url"
        label={t("workflows.field.baseUrl")}
        error={msg(errors.base_url?.message)}
      >
        {(p) => (
          <Input
            {...p}
            {...register("base_url")}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        )}
      </FormField>
      <FormField
        id="wf-output"
        label={t("workflows.field.outputField")}
        error={msg(errors.output_field?.message)}
      >
        {(p) => (
          <Input {...p} {...register("output_field")} autoComplete="off" className="font-mono" />
        )}
      </FormField>
      <FormField
        id="wf-desc"
        label={t("workflows.field.description")}
        description={`${t("workflows.field.descHint")} ${t("workflows.field.descCount", { n: desc.trim().length })}`}
        error={msg(errors.description?.message)}
      >
        {(p) => <Textarea {...p} {...register("description")} rows={5} />}
      </FormField>
      <div className="flex items-center gap-3">
        <Controller
          control={control}
          name="enabled"
          render={({ field }) => (
            <Switch id="wf-enabled" checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
        <Label htmlFor="wf-enabled">{t("workflows.field.enabled")}</Label>
      </div>
      <div className="flex items-start gap-3">
        <Controller
          control={control}
          name="side_effect"
          render={({ field }) => (
            <Switch
              id="wf-side-effect"
              aria-describedby="wf-side-effect-desc"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
        <div className="space-y-1">
          <Label htmlFor="wf-side-effect">{t("workflows.field.sideEffect")}</Label>
          <p id="wf-side-effect-desc" className="text-caption text-muted-foreground">
            {t("workflows.field.sideEffectHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
