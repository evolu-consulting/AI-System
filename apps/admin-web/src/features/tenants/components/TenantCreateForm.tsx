// ADM-FR-60 · form tạo tenant (canvas TenantCreate): card Công ty + card Tenant admin đầu tiên, một nút "Tạo tenant" cuối trang.
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { foldKeyInput } from "@/lib/normalize";
import { useTr } from "@/lib/use-translate";
import { type TenantCreateValues, tenantCreateSchema } from "../lib/schemas";

export type CreateFieldErrors = Partial<Record<"key" | "username" | "email", string>>;

type Props = {
  pending: boolean;
  /** Lỗi theo ô từ server (409 KEY_TAKEN…), đã dịch. */
  serverErrors: CreateFieldErrors;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSubmit: (values: TenantCreateValues) => void;
};

export function TenantCreateForm({
  pending,
  serverErrors,
  onDirtyChange,
  onCancel,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const form = useForm<TenantCreateValues>({
    resolver: zodResolver(tenantCreateSchema),
    mode: "onTouched",
    defaultValues: {
      key: "",
      name: "",
      slots: "",
      username: "",
      display_name: "",
      email: "",
      locale: "vi",
    },
  });
  const { errors, isDirty } = form.formState;
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);
  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  // Lỗi 409 theo ô: đưa focus về ô đầu tiên bị lỗi.
  useEffect(() => {
    const first = (["key", "username", "email"] as const).find((k) => serverErrors[k]);
    if (first) form.setFocus(first);
  }, [serverErrors, form]);

  const key = form.register("key");

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("tenants.new.company")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            id="tenant-key"
            label={t("tenants.field.key")}
            description={t("tenants.field.keyHint")}
            error={msg(errors.key?.message) ?? serverErrors.key}
          >
            {(p) => (
              <Input
                {...p}
                {...key}
                onChange={(e) => {
                  e.target.value = foldKeyInput(e.target.value);
                  return key.onChange(e);
                }}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            )}
          </FormField>
          <FormField
            id="tenant-name"
            label={t("tenants.field.name")}
            error={msg(errors.name?.message)}
          >
            {(p) => <Input {...p} {...form.register("name")} autoComplete="off" />}
          </FormField>
          <FormField
            id="tenant-slots"
            label={t("tenants.field.slots")}
            description={t("tenants.field.slotsHint")}
            error={msg(errors.slots?.message)}
          >
            {(p) => (
              <Input {...p} {...form.register("slots")} type="number" min={1} inputMode="numeric" />
            )}
          </FormField>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("tenants.new.firstAdmin")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            id="admin-username"
            label={t("users.field.username")}
            error={msg(errors.username?.message) ?? serverErrors.username}
          >
            {(p) => (
              <Input {...p} {...form.register("username")} autoComplete="off" spellCheck={false} />
            )}
          </FormField>
          <FormField
            id="admin-display"
            label={t("users.field.displayName")}
            error={msg(errors.display_name?.message)}
          >
            {(p) => <Input {...p} {...form.register("display_name")} autoComplete="off" />}
          </FormField>
          <FormField
            id="admin-email"
            label={t("users.field.email")}
            error={msg(errors.email?.message) ?? serverErrors.email}
          >
            {(p) => <Input {...p} {...form.register("email")} type="email" autoComplete="off" />}
          </FormField>
          <FormField id="admin-locale" label={t("users.field.locale")}>
            {(p) => (
              <Select
                value={form.watch("locale")}
                onValueChange={(v) =>
                  form.setValue("locale", v as "vi" | "en", { shouldDirty: true })
                }
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
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} aria-disabled={pending}>
          {t("tenants.new.submit")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
