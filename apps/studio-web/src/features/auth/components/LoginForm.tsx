// HUB-FR-72 · form mật khẩu (mẫu Admin ui-admin §7.1): Mã công ty, Tên đăng nhập, Mật khẩu; lỗi `role=alert` dưới form.
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";

export type LoginValues = { tenant_key: string; username: string; password: string };

type Props = {
  defaultTenant: string;
  pending: boolean;
  error: string | null;
  onSubmit: (values: LoginValues) => void;
};

const ERROR_ID = "login-error";

export function LoginForm({ defaultTenant, pending, error, onSubmit }: Props) {
  const { t } = useTranslation();
  const [tenant, setTenant] = useState(defaultTenant);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const describedBy = error ? ERROR_ID : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    onSubmit({
      tenant_key: tenant.trim().toLowerCase(),
      username: username.trim().toLowerCase(),
      password,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="login-tenant">{t("login.tenant")}</Label>
        <Input
          id="login-tenant"
          value={tenant}
          onChange={(e) => setTenant(e.target.value)}
          autoComplete="organization"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={100}
          aria-describedby={describedBy}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-username">{t("login.username")}</Label>
        <Input
          id="login-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={100}
          aria-describedby={describedBy}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-password">{t("login.password")}</Label>
        <Input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          aria-describedby={describedBy}
        />
      </div>
      {error ? (
        <p
          id={ERROR_ID}
          role="alert"
          className="rounded-md bg-warning-bg px-3 py-2 text-label text-warning"
        >
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("login.submitting") : t("login.submit")}
      </Button>
    </form>
  );
}
