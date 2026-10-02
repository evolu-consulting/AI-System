// ADM-FR-04, ADM-FR-63 · form tạo/sửa user trong drawer: tên đăng nhập, tên hiển thị, email, role (radio), ngôn ngữ.
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
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
import { useTr } from "@/lib/use-translate";
import { type UserCreateValues, userCreateSchema } from "../../lib/schemas";

export type UserFormErrors = { username?: string; email?: string; role?: string };
type Role = UserCreateValues["role"];

type Props = {
  formId: string;
  mode: "create" | "edit";
  tenantKey: string;
  defaults: UserCreateValues;
  /** Hàng của chính mình: không đổi được role (M1-AC05). */
  selfRole: boolean;
  serverErrors: UserFormErrors;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (values: UserCreateValues) => void;
};

export function UserForm({
  formId,
  mode,
  tenantKey,
  defaults,
  selfRole,
  serverErrors,
  onDirtyChange,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const form = useForm<UserCreateValues>({
    resolver: zodResolver(userCreateSchema),
    mode: "onTouched",
    defaultValues: defaults,
  });
  const { errors, isDirty } = form.formState;
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);
  const role = form.watch("role");
  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);
  useEffect(() => {
    const first = (["username", "email", "role"] as const).find((k) => serverErrors[k]);
    if (first && first !== "role") form.setFocus(first);
  }, [serverErrors, form]);

  const roleItem = (value: Role, disabled = false) => (
    <div className="flex items-center gap-2">
      <RadioGroupItem
        value={value}
        id={`${formId}-role-${value}`}
        disabled={disabled || selfRole}
      />
      <Label htmlFor={`${formId}-role-${value}`} className="font-mono">
        {value}
      </Label>
    </div>
  );

  return (
    <form id={formId} onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <p className="text-label text-muted-foreground">
        {t("users.drawer.tenantLine", { key: tenantKey })}
      </p>
      <FormField
        id={`${formId}-username`}
        label={t("users.field.username")}
        error={msg(errors.username?.message) ?? serverErrors.username}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register("username")}
            readOnly={mode === "edit"}
            autoComplete="off"
            spellCheck={false}
            className={mode === "edit" ? "bg-muted font-mono" : "font-mono"}
          />
        )}
      </FormField>
      <FormField
        id={`${formId}-display`}
        label={t("users.field.displayName")}
        error={msg(errors.display_name?.message)}
      >
        {(p) => <Input {...p} {...form.register("display_name")} autoComplete="off" />}
      </FormField>
      <FormField
        id={`${formId}-email`}
        label={t("users.field.email")}
        error={msg(errors.email?.message) ?? serverErrors.email}
      >
        {(p) => <Input {...p} {...form.register("email")} type="email" autoComplete="off" />}
      </FormField>
      <FormField
        id={`${formId}-role`}
        label={t("users.field.role")}
        description={selfRole ? t("users.field.selfRole") : undefined}
        error={serverErrors.role}
      >
        {(p) => (
          <RadioGroup
            {...p}
            value={role}
            onValueChange={(v) => form.setValue("role", v as Role, { shouldDirty: true })}
            className="gap-2"
          >
            {roleItem("member")}
            {roleItem("tenant_admin")}
            {tenantKey === "platform" ? roleItem("platform_admin", true) : null}
          </RadioGroup>
        )}
      </FormField>
      <FormField id={`${formId}-locale`} label={t("users.field.locale")}>
        {(p) => (
          <Select
            value={form.watch("locale")}
            onValueChange={(v) => form.setValue("locale", v as "vi" | "en", { shouldDirty: true })}
          >
            <SelectTrigger {...p} className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vi">{t("auth.lang.vi")}</SelectItem>
              <SelectItem value="en">{t("auth.lang.en")}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </FormField>
      {mode === "create" ? (
        <p className="text-caption text-muted-foreground">{t("users.create.passwordNote")}</p>
      ) : null}
    </form>
  );
}
