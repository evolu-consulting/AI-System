// HUB-FR-72 · H4a-QF2 · bước 2FA khi đăng nhập (như Admin): mã 6 số hoặc mã dự phòng `xxxx-xxxx`; "Quay lại đăng nhập".
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";

export type TotpInput = { code: string } | { backup_code: string };

// Khớp `TotpCodeSchema` / `BackupCodeSchema` (@ai/contracts totp.ts) — chép regex để không kéo zod vào chunk đăng nhập.
const CODE_RE = /^\d{6}$/;
const BACKUP_RE = /^[2-9a-hjkmnp-z]{4}-?[2-9a-hjkmnp-z]{4}$/i;

type Props = {
  account: string;
  busy: boolean;
  error: string | null;
  onError: (message: string | null) => void;
  /** Trả `false` khi thất bại (xoá ô và focus lại). */
  onSubmit: (input: TotpInput) => Promise<boolean>;
  onBack: () => void;
};

const ERROR_ID = "login-totp-error";

export function TotpForm({ account, busy, error, onError, onSubmit, onBack }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"app" | "backup">("app");
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const describedBy = error ? ERROR_ID : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v = value.trim();
    let input: TotpInput;
    if (mode === "app") {
      if (!CODE_RE.test(v)) return onError(t("login.totp.wrong"));
      input = { code: v };
    } else {
      if (!BACKUP_RE.test(v)) return onError(t("login.totp.backupFormat"));
      input = { backup_code: v.toLowerCase() };
    }
    if (!(await onSubmit(input))) {
      setValue("");
      // Đợi render bỏ `disabled` rồi mới focus.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const switchMode = () => {
    setMode((m) => (m === "app" ? "backup" : "app"));
    setValue("");
    onError(null);
  };

  const label = mode === "app" ? t("login.totp.code") : t("login.totp.backupCode");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-page-title font-bold text-foreground">{t("login.totp.title")}</h1>
        <p className="text-body text-muted-foreground">{t("login.totp.body")}</p>
        <p className="font-mono text-label text-foreground">{account}</p>
      </div>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="login-totp">{label}</Label>
          <Input
            ref={inputRef}
            id="login-totp"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode={mode === "app" ? "numeric" : "text"}
            autoComplete={mode === "app" ? "one-time-code" : "off"}
            placeholder={mode === "app" ? "000000" : "xxxx-xxxx"}
            maxLength={mode === "app" ? 6 : 9}
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="font-mono"
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
        <Button type="submit" className="w-full" disabled={busy}>
          {t("login.totp.submit")}
        </Button>
      </form>
      <div className="flex flex-col items-start gap-2 text-label">
        <Button type="button" variant="link" className="h-auto p-0" onClick={switchMode}>
          {mode === "app" ? t("login.totp.useBackup") : t("login.totp.useApp")}
        </Button>
        <Button type="button" variant="link" className="h-auto p-0" onClick={onBack}>
          {t("login.totp.back")}
        </Button>
      </div>
    </div>
  );
}
