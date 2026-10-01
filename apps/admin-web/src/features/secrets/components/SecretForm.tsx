// ADM-FR-50 · M2-R01 · form trong drawer: Thêm (tên, giá trị, ghi chú), Thay giá trị (chỉ giá trị mới), Sửa ghi chú.
// Giá trị chỉ sống trong state RHF của form này; form unmount khi đóng drawer nên không còn nằm lại (D10).
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { typeSecretName } from "@/lib/normalize";
import { useTr } from "@/lib/use-translate";
import { type SecretFormMode, type SecretFormValues, secretResolver } from "../lib/schemas";
import { SecretField } from "./SecretField";

export type SecretFormErrors = Partial<Record<keyof SecretFormValues, string>>;

type Props = {
  formId: string;
  mode: SecretFormMode;
  defaultNote: string;
  serverErrors: SecretFormErrors;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (values: SecretFormValues) => void | Promise<void>;
};

export function SecretForm({
  formId,
  mode,
  defaultNote,
  serverErrors,
  onDirtyChange,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const form = useForm<SecretFormValues>({
    resolver: secretResolver(mode),
    mode: "onTouched",
    defaultValues: { name: "", value: "", note: defaultNote },
  });
  const { errors, isDirty } = form.formState;
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);
  const hasValue = form.watch("value") !== "";
  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);
  useEffect(() => {
    const first = (["name", "value", "note"] as const).find((k) => serverErrors[k]);
    if (first) form.setFocus(first);
  }, [serverErrors, form]);

  const submit = form.handleSubmit(async (values) => {
    await onSubmit(values);
    // D10: xoá giá trị khỏi state ngay khi gửi xong (kể cả khi lỗi, người dùng nhập lại).
    form.resetField("value", { defaultValue: "" });
  });

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4">
      {mode === "create" ? (
        <FormField
          id={`${formId}-name`}
          label={t("secrets.field.name")}
          error={msg(errors.name?.message) ?? serverErrors.name}
        >
          {(p) => (
            <Input
              {...p}
              {...form.register("name", {
                onChange: (e) =>
                  form.setValue("name", typeSecretName(e.target.value), { shouldDirty: true }),
              })}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          )}
        </FormField>
      ) : null}
      {mode === "note" ? null : (
        <SecretField
          id={`${formId}-value`}
          label={t(mode === "create" ? "secrets.field.value" : "secrets.field.newValue")}
          registration={form.register("value")}
          hasValue={hasValue}
          description={t("secrets.field.noValueHint")}
          error={msg(errors.value?.message) ?? serverErrors.value}
        />
      )}
      {mode === "replace" ? null : (
        <FormField
          id={`${formId}-note`}
          label={t("secrets.field.note")}
          error={msg(errors.note?.message) ?? serverErrors.note}
        >
          {(p) => <Textarea {...p} {...form.register("note")} rows={3} />}
        </FormField>
      )}
    </form>
  );
}
