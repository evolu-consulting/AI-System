// ADM-FR-08 · ms §10.2 (mẫu D, thay card đăng nhập): mã 6 số tự gửi khi đủ; hoặc mã dự phòng; "Quay lại đăng nhập".
import { type FormEvent, type MouseEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { OtpInput } from "@/components/shared/form/OtpInput";
import { isOtpComplete } from "@/components/shared/form/otp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TotpLoginInput } from "../../hooks/use-totp-login";
import { normalizeBackupCode } from "../../lib/schemas";

type Props = {
  tenantKey: string;
  username: string;
  busy: boolean;
  error: string | null;
  onError: (message: string | null) => void;
  onSubmit: (input: TotpLoginInput) => Promise<boolean>;
  onBack: () => void;
  /** `false` khi nơi chứa đã có tiêu đề riêng (hộp thoại phiên hết hạn). Mặc định `true`. */
  showHeader?: boolean;
};

const ERROR_ID = "login-totp-error";

export function LoginTotpStep(props: Props) {
  const { t } = useTranslation();
  const { tenantKey, username, busy, error, onError, onSubmit, onBack } = props;
  const showHeader = props.showHeader ?? true;
  const [mode, setMode] = useState<"app" | "backup">("app");
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState("");
  const codeRef = useRef<HTMLDivElement>(null);

  const sendCode = async (value: string) => {
    if (!(await onSubmit({ code: value }))) {
      setCode("");
      codeRef.current?.querySelector("input")?.focus();
    }
  };
  const sendBackup = async () => {
    const normalized = normalizeBackupCode(backup);
    if (!normalized) return onError(t("auth.login.totp.backupFormat"));
    if (!(await onSubmit({ backup_code: normalized }))) setBackup("");
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "backup") void sendBackup();
    else if (isOtpComplete(code)) void sendCode(code);
  };
  const switchMode = (next: "app" | "backup") => {
    setMode(next);
    setCode("");
    setBackup("");
    onError(null);
  };
  const back = (e: MouseEvent) => {
    e.preventDefault();
    onBack();
  };
  const describedBy = error ? ERROR_ID : undefined;

  return (
    <div className="space-y-6">
      {showHeader ? (
        <div className="space-y-1">
          <h1 className="text-page-title font-bold text-foreground">
            {t("auth.login.totp.title")}
          </h1>
          <p className="text-body text-muted-foreground">{t("auth.login.totp.body")}</p>
          <p className="font-mono text-label text-foreground">{`${tenantKey} · ${username}`}</p>
        </div>
      ) : null}
      <form onSubmit={submit} noValidate className="space-y-4">
        {mode === "app" ? (
          <div ref={codeRef} className="space-y-1.5">
            <Label htmlFor="login-totp-code">{t("auth.login.totp.code")}</Label>
            <OtpInput
              id="login-totp-code"
              label={t("auth.login.totp.code")}
              value={code}
              onChange={setCode}
              onComplete={(v) => void sendCode(v)}
              disabled={busy}
              invalid={Boolean(error)}
              autoFocus
              aria-describedby={describedBy}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="login-totp-backup">{t("auth.login.totp.backupCode")}</Label>
            <Input
              id="login-totp-backup"
              value={backup}
              onChange={(e) => setBackup(e.target.value)}
              placeholder="xxxx-xxxx"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className="font-mono"
            />
          </div>
        )}
        {error ? (
          <p
            id={ERROR_ID}
            role="alert"
            className="rounded-md bg-warning-bg px-3 py-2 text-label text-warning"
          >
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={busy || (mode === "app" && !isOtpComplete(code))}
          aria-disabled={busy}
        >
          {t("auth.login.totp.submit")}
        </Button>
      </form>
      <div className="flex flex-col items-start gap-2 text-label">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          onClick={() => switchMode(mode === "app" ? "backup" : "app")}
        >
          {mode === "app" ? t("auth.login.totp.useBackup") : t("auth.login.totp.useApp")}
        </Button>
        <a href="/login" onClick={back} className="text-primary underline-offset-4 hover:underline">
          {t("auth.login.totp.back")}
        </a>
      </div>
    </div>
  );
}
