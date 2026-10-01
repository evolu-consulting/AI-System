// ADM-BR-01 · ADM-BR-10 · bước 1 "Đặt tên và gói chức năng": tên (chuẩn hoá khi gõ, kiểm trùng khi rời ô), alias, mô tả VI/EN, feature.
import { useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { LocalizedInput } from "@/components/shared/LocalizedInput";
import { Input } from "@/components/ui/input";
import { normalizeCommandName } from "@/lib/normalize";
import { useTr } from "@/lib/use-translate";
import { useNameCheck } from "../../hooks/use-command-queries";
import type { CommandFormValues } from "../../lib/schemas";
import { AliasField } from "./AliasField";
import { FeatureField } from "./FeatureField";
import { StepSection } from "./StepSection";

export type StepNameErrors = { name?: string; alias?: string; feature?: string };

type Props = { excludeId?: string; serverErrors: StepNameErrors };

export function StepName({ excludeId, serverErrors }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const { register, control, setValue, getValues, formState } = useFormContext<CommandFormValues>();
  const { errors } = formState;
  const isTaken = useNameCheck(excludeId);
  const [taken, setTaken] = useState<string>();
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);

  const checkTaken = async () => {
    const name = getValues("name");
    if (!name) return;
    const conflict = await isTaken(name);
    setTaken(conflict ? tr("commands.error.nameTaken", { name }) : undefined);
  };

  return (
    <StepSection n={1} title={t("commands.step1")}>
      <FormField
        id="cmd-name"
        label={t("commands.field.name")}
        error={msg(errors.name?.message) ?? taken ?? serverErrors.name}
      >
        {(p) => (
          <div className="flex items-center gap-1">
            <span aria-hidden className="font-mono text-muted-foreground">
              /
            </span>
            <Input
              {...p}
              {...register("name", {
                onChange: (e) => {
                  setTaken(undefined);
                  setValue("name", normalizeCommandName(e.target.value), { shouldDirty: true });
                },
                onBlur: () => void checkTaken(),
              })}
              autoComplete="off"
              spellCheck={false}
              className="max-w-xs font-mono"
            />
          </div>
        )}
      </FormField>
      <AliasField excludeId={excludeId} serverError={serverErrors.alias} />
      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <LocalizedInput
            id="cmd-desc"
            label={t("commands.field.descriptionLabel")}
            description={t("commands.field.description")}
            value={field.value}
            onChange={field.onChange}
            multiline
            error={msg(errors.description?.vi?.message ?? errors.description?.en?.message)}
          />
        )}
      />
      <FeatureField serverError={serverErrors.feature} />
    </StepSection>
  );
}
