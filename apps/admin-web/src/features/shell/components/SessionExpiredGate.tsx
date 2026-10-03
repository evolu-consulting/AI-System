// ADM-FR-01, ADM-FR-02, ADM-FR-08 · modal "Phiên đăng nhập đã hết hạn" tại chỗ: nhập lại mật khẩu (và mã 2FA nếu user đã bật), dữ liệu form giữ nguyên (ui-admin 7.1).
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { PasswordField } from "@/components/shared/form/PasswordField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { LoginTotpStep } from "@/features/auth/components/totp/LoginTotpStep";
import { useTotpLogin } from "@/features/auth/hooks/use-totp-login";
import { session } from "@/lib/auth/session";
import { useSession } from "@/lib/auth/use-session";
import { describeLoginError } from "@/lib/errors";
import { useTr } from "@/lib/use-translate";

export function SessionExpiredGate() {
  const { t } = useTranslation();
  const tr = useTr();
  const navigate = useNavigate();
  const expired = useSession((s) => s.status === "expired");
  const tenantKey = useSession((s) => s.me?.tenant.key ?? "");
  const username = useSession((s) => s.me?.username ?? "");
  // TECH-DEBT #31: mật khẩu đúng nhưng user bật 2FA → bước mã ngay trong hộp thoại.
  const totpStep = useSession((s) => s.status === "expired" && s.pendingTotp !== null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // `authenticated` → session đóng hộp thoại (status `authed`); không cần làm gì thêm.
  const totp = useTotpLogin({ onDone: async () => undefined, onExpired: setError });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError(t("auth.error.required.password"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await session.relogin(password);
      setPassword("");
    } catch (err) {
      const spec = describeLoginError(err);
      setError(tr(spec.key, spec.params));
    } finally {
      setPending(false);
    }
  };

  const signOut = async () => {
    await session.logout();
    await navigate({ to: "/login", search: {} });
  };

  const footer = (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={signOut} disabled={pending || totp.busy}>
        {t("auth.logout")}
      </Button>
      {totpStep ? null : (
        <Button type="submit" disabled={pending}>
          {pending ? t("auth.login.submitting") : t("auth.login.submit")}
        </Button>
      )}
    </DialogFooter>
  );

  return (
    <Dialog open={expired}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {totpStep ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("session.expired.title")}</DialogTitle>
              <DialogDescription>{t("auth.login.totp.body")}</DialogDescription>
            </DialogHeader>
            <p className="font-mono text-body text-muted-foreground">
              {tenantKey} · {username}
            </p>
            <LoginTotpStep
              tenantKey={tenantKey}
              username={username}
              busy={totp.busy}
              error={totp.error}
              onError={totp.setError}
              onSubmit={totp.submit}
              onBack={() => {
                totp.setError(null);
                session.clearPendingTotp();
              }}
              showHeader={false}
            />
            {footer}
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{t("session.expired.title")}</DialogTitle>
              <DialogDescription>{t("session.expired.body")}</DialogDescription>
            </DialogHeader>
            <p className="font-mono text-body text-muted-foreground">
              {tenantKey} · {username}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="relogin-password">{t("auth.login.field.password")}</Label>
              <PasswordField
                id="relogin-password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "relogin-error" : undefined}
              />
              {error ? (
                <p id="relogin-error" role="alert" className="text-caption text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
            {footer}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
