// ADM-FR-08 · ms §10.1 bước 0: xác thực lại bằng mật khẩu hiện tại trước khi nhận secret.
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { PasswordField } from "@/components/shared/form/PasswordField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Props = {
  busy: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
};

export function ReauthStep({ busy, error, onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) onSubmit(password);
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h2 className="text-card-title font-semibold">{t("twofa.reauth")}</h2>
      <div className="space-y-1.5">
        <Label htmlFor="totp-reauth">{t("password.field.current")}</Label>
        <PasswordField
          id="totp-reauth"
          autoComplete="current-password"
          autoFocus
          value={password}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "totp-reauth-error" : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? (
          <p id="totp-reauth-error" role="alert" className="text-caption text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy || !password}>
          {t("common.continue")}
        </Button>
      </div>
    </form>
  );
}
