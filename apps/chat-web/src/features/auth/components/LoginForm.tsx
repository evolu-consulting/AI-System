// CHAT-AC-01, CHAT-AC-02 · form đăng nhập: mã công ty (nhớ trên thiết bị, "Đổi công ty" để sửa), tên đăng nhập, mật khẩu;
// lỗi chung ở vùng `role=alert` trên nút, giữ giá trị, focus lại ô Mật khẩu.
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field } from "./Field";

export type LoginValues = { tenant_key: string; username: string; password: string };

type Props = {
  defaultTenant: string;
  pending: boolean;
  /** Câu lỗi chung đã dịch (sai thông tin, mạng, cần hoàn tất trong Admin…). */
  error: string | null;
  onSubmit: (values: LoginValues) => void;
};

const notBlank = (v: string) => v.trim() !== "";

export function LoginForm({ defaultTenant, pending, error, onSubmit }: Props) {
  const { t } = useTranslation();
  // Có mã đã nhớ → khoá ô, bấm "Đổi công ty" mới sửa.
  const [editTenant, setEditTenant] = useState(defaultTenant === "");
  const form = useForm<LoginValues>({
    mode: "onTouched",
    defaultValues: { tenant_key: defaultTenant, username: "", password: "" },
  });
  const { errors } = form.formState;
  const required = { validate: (v: string) => notBlank(v) || t("login.required") };

  useEffect(() => {
    if (error) form.setFocus("password", { shouldSelect: true });
  }, [error, form]);

  const changeTenant = () => {
    setEditTenant(true);
    // Chờ bỏ readOnly rồi mới focus + chọn hết để gõ đè.
    requestAnimationFrame(() => form.setFocus("tenant_key", { shouldSelect: true }));
  };

  const changeButton = editTenant ? null : (
    <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={changeTenant}>
      {t("login.changeTenant")}
    </Button>
  );

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <Field
        id="login-tenant"
        label={t("login.tenant")}
        hint={editTenant ? undefined : t("login.tenantRemembered")}
        error={errors.tenant_key?.message}
        action={changeButton}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register("tenant_key", required)}
            defaultValue={defaultTenant}
            readOnly={!editTenant}
            autoComplete="organization"
            autoCapitalize="none"
            spellCheck={false}
            className="font-mono read-only:bg-muted"
          />
        )}
      </Field>
      <Field id="login-username" label={t("login.username")} error={errors.username?.message}>
        {(p) => (
          <Input
            {...p}
            {...form.register("username", required)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
        )}
      </Field>
      <Field id="login-password" label={t("login.password")} error={errors.password?.message}>
        {(p) => (
          <Input
            {...p}
            {...form.register("password", {
              validate: (v: string) => v !== "" || t("login.required"),
            })}
            type="password"
            autoComplete="current-password"
          />
        )}
      </Field>
      {error ? (
        <p role="alert" className="rounded-md bg-warning-bg px-3 py-2 text-label text-warning">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("login.submitting") : t("login.submit")}
      </Button>
    </form>
  );
}
