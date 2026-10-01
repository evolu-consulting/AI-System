// ADM-FR-01 · form đăng nhập: mã công ty (mono), tên đăng nhập, mật khẩu; lỗi chung ở vùng alert trên nút, giữ giá trị.
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/FormField";
import { PasswordField } from "@/components/shared/PasswordField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTr } from "@/lib/use-translate";
import { type LoginValues, loginSchema } from "../lib/schemas";

type Props = {
  defaultTenant: string;
  pending: boolean;
  /** Câu lỗi chung đã dịch (đăng nhập sai, khoá tạm, mạng…). */
  error: string | null;
  onSubmit: (values: LoginValues) => void;
};

export function LoginForm({ defaultTenant, pending, error, onSubmit }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: "onTouched",
    defaultValues: { tenant_key: defaultTenant, username: "", password: "" },
  });
  const { errors } = form.formState;
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);

  // Sau lỗi: focus về ô Mật khẩu và chọn toàn bộ để gõ lại ngay.
  useEffect(() => {
    if (!error) return;
    form.setFocus("password", { shouldSelect: true });
  }, [error, form]);

  const password = form.register("password");

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FormField
        id="login-tenant"
        label={t("auth.login.field.tenant")}
        description={t("auth.login.field.tenantHint")}
        error={msg(errors.tenant_key?.message)}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register("tenant_key")}
            autoComplete="organization"
            autoCapitalize="none"
            spellCheck={false}
            className="font-mono"
          />
        )}
      </FormField>
      <FormField
        id="login-username"
        label={t("auth.login.field.username")}
        error={msg(errors.username?.message)}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register("username")}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
        )}
      </FormField>
      <FormField
        id="login-password"
        label={t("auth.login.field.password")}
        error={msg(errors.password?.message)}
      >
        {(p) => <PasswordField {...p} {...password} autoComplete="current-password" />}
      </FormField>
      {error ? (
        <p role="alert" className="rounded-md bg-warning-bg px-3 py-2 text-label text-warning">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending} aria-disabled={pending}>
        {pending ? t("auth.login.submitting") : t("auth.login.submit")}
      </Button>
      <p className="text-caption text-muted-foreground">{t("auth.login.forgot")}</p>
    </form>
  );
}
