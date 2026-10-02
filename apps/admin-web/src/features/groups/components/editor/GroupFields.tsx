// ADM-FR-62 · M3-R01 · các trường của form group dùng chung cho tạo mới (Key + Tên + Mô tả) và "Đổi tên" (Tên + Mô tả).
import { Controller, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { LocalizedInput } from "@/components/shared/LocalizedInput";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTr } from "@/lib/use-translate";
import { type GroupFormValues, typeGroupKey } from "../../lib/schemas";

type Props = { withKey: boolean; idPrefix: string };

export function GroupFields({ withKey, idPrefix }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const { register, control, watch, formState } = useFormContext<GroupFormValues>();
  const { errors } = formState;
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);
  const count = watch("description").length;

  return (
    <div className="space-y-4">
      {withKey ? (
        <FormField
          id={`${idPrefix}-key`}
          label={t("groups.field.key")}
          error={msg(errors.key?.message)}
        >
          {(p) => (
            <Input
              {...p}
              {...register("key", {
                onChange: (e) => {
                  e.target.value = typeGroupKey(e.target.value);
                },
              })}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          )}
        </FormField>
      ) : null}
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <LocalizedInput
            id={`${idPrefix}-name`}
            label={t("groups.field.name")}
            value={field.value}
            onChange={field.onChange}
            error={msg(errors.name?.vi?.message ?? errors.name?.en?.message)}
          />
        )}
      />
      <FormField
        id={`${idPrefix}-desc`}
        label={t("groups.field.description")}
        description={t("groups.field.descCount", { n: count })}
        error={msg(errors.description?.message)}
      >
        {(p) => <Textarea {...p} {...register("description")} rows={3} />}
      </FormField>
    </div>
  );
}
