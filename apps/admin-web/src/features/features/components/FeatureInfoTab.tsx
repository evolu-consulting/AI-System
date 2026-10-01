// ADM-FR-30 · ADM-BR-10 · tab "Thông tin": key (khoá sau khi lưu), tên + mô tả VI/EN, icon, trạng thái (`core` khoá).
import { FEATURE_STATUSES } from "@ai/contracts";
import { Controller, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { LocalizedInput } from "@/components/shared/LocalizedInput";
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
import { useTr } from "@/lib/use-translate";
import { FEATURE_ICON_NAMES } from "../lib/icons";
import type { FeatureFormValues } from "../lib/schemas";
import { FeatureIcon } from "./FeatureIcon";

type Props = { editing: boolean; isCore: boolean };

export function FeatureInfoTab({ editing, isCore }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const { register, control, watch, formState } = useFormContext<FeatureFormValues>();
  const { errors } = formState;
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);
  const status = watch("status");

  return (
    <div className="max-w-2xl space-y-4">
      <FormField
        id="feat-key"
        label={t("features.field.key")}
        description={editing ? t("features.field.keyLocked") : undefined}
        error={msg(errors.key?.message)}
      >
        {(p) => (
          <Input
            {...p}
            {...register("key")}
            readOnly={editing}
            autoComplete="off"
            spellCheck={false}
            className={editing ? "bg-muted font-mono" : "font-mono"}
          />
        )}
      </FormField>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <LocalizedInput
            id="feat-name"
            label={t("features.field.name")}
            value={field.value}
            onChange={field.onChange}
            error={msg(errors.name?.vi?.message ?? errors.name?.en?.message)}
          />
        )}
      />
      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <LocalizedInput
            id="feat-desc"
            label={t("features.field.description")}
            value={field.value}
            onChange={field.onChange}
            multiline
            error={msg(errors.description?.vi?.message ?? errors.description?.en?.message)}
          />
        )}
      />
      <FormField id="feat-icon" label={t("features.field.icon")}>
        {(p) => (
          <Controller
            control={control}
            name="icon"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger {...p} className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FEATURE_ICON_NAMES.map((n) => (
                    <SelectItem key={n} value={n}>
                      <FeatureIcon name={n} />
                      {t(`features.icon.${n}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </FormField>
      <FormField
        id="feat-status"
        label={t("features.field.status")}
        description={
          isCore
            ? t("features.core.hint")
            : status === "beta"
              ? t("features.field.betaHint")
              : undefined
        }
      >
        {(p) => (
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <RadioGroup
                {...p}
                aria-label={t("features.field.status")}
                value={field.value}
                onValueChange={field.onChange}
                disabled={isCore}
                className="flex gap-4"
              >
                {FEATURE_STATUSES.map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <RadioGroupItem value={s} id={`feat-status-${s}`} />
                    <Label htmlFor={`feat-status-${s}`}>{t(`features.status.${s}`)}</Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          />
        )}
      </FormField>
    </div>
  );
}
