// ADM-FR-08 · ms §10.1 · hộp thoại Tắt 2FA (mật khẩu + mã) / Tạo lại mã dự phòng (mã): bấm nút mới gửi,
// sai → alert trong hộp thoại, hộp thoại giữ mở.
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OtpInput } from "@/components/shared/form/OtpInput";
import { isOtpComplete } from "@/components/shared/form/otp";
import { PasswordField } from "@/components/shared/form/PasswordField";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { TotpConfirmValues } from "../../lib/totp-steps";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Tắt 2FA cần mật khẩu; tạo lại mã chỉ cần mã (Q-D1). */
  needPassword: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (values: TotpConfirmValues) => void;
};

export function TotpConfirmDialog(p: Props) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => {
    if (!p.open) {
      setPassword("");
      setCode("");
    }
  }, [p.open]);
  const ready = isOtpComplete(code) && (!p.needPassword || password.length > 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready && !p.busy) p.onConfirm({ password, code });
  };
  return (
    <AlertDialog open={p.open} onOpenChange={(next) => !p.busy && p.onOpenChange(next)}>
      <AlertDialogContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <AlertDialogHeader>
            <AlertDialogTitle>{p.title}</AlertDialogTitle>
            <AlertDialogDescription>{p.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {p.needPassword ? (
            <div className="space-y-1.5">
              <Label htmlFor="totp-confirm-password">{t("password.field.current")}</Label>
              <PasswordField
                id="totp-confirm-password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="totp-confirm-code">{t("twofa.code")}</Label>
            <OtpInput
              id="totp-confirm-code"
              label={t("twofa.code")}
              value={code}
              onChange={setCode}
              invalid={Boolean(p.error)}
              autoFocus={!p.needPassword}
            />
          </div>
          {p.error ? (
            <p role="alert" className="text-caption text-danger">
              {p.error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={p.busy}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <Button
              type="submit"
              variant={p.destructive ? "destructive" : "default"}
              disabled={!ready || p.busy}
            >
              {p.confirmLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
