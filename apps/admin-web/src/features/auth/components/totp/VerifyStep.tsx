// ADM-FR-08 · ms §10.1 bước 2: mã 6 số, tự gửi khi đủ; sai → `twofa.verify.wrong`, xoá ô.
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OtpInput } from "@/components/shared/form/OtpInput";
import { isOtpComplete } from "@/components/shared/form/otp";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Props = {
  busy: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  onBack: () => void;
};

export function VerifyStep({ busy, error, onSubmit, onBack }: Props) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  useEffect(() => {
    if (error) setCode("");
  }, [error]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (isOtpComplete(code)) onSubmit(code);
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h2 className="text-card-title font-semibold">{t("twofa.verify.title")}</h2>
      <div className="space-y-1.5">
        <Label htmlFor="totp-verify" className="sr-only">
          {t("twofa.code")}
        </Label>
        <OtpInput
          id="totp-verify"
          label={t("twofa.code")}
          value={code}
          onChange={setCode}
          onComplete={onSubmit}
          disabled={busy}
          invalid={Boolean(error)}
          autoFocus
          aria-describedby={error ? "totp-verify-error" : undefined}
        />
        {error ? (
          <p id="totp-verify-error" role="alert" className="text-caption text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          {t("common.back")}
        </Button>
        <Button type="submit" disabled={busy || !isOtpComplete(code)}>
          {t("twofa.verify.submit")}
        </Button>
      </div>
    </form>
  );
}
