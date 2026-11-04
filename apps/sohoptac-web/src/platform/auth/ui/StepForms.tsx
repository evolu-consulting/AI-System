// CR-118 · cr118-auth · form bước 2 của login gộp (port `community-web/src/ui/Login.tsx` StageFields): đổi mật khẩu bắt buộc
// (mới + nhập lại) và mã TOTP / mã dự phòng. Chỉ nhận dữ liệu + callback (không gọi API). Nhãn e2e: textbox "Mật khẩu mới",
// "Nhập lại mật khẩu mới", "Mã xác thực"; button "Lưu mật khẩu" / "Xác nhận" / "Quay lại đăng nhập".
import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

export const AUTH_FIELD =
  "mt-1 h-10 w-full rounded-lg border border-field bg-panel px-3 text-sm text-ink focus:outline-2 focus:outline-act focus:-outline-offset-1";
const SUBMIT =
  "inline-flex h-11 items-center justify-center rounded-lg bg-act px-4 text-sm font-semibold text-on-act disabled:cursor-not-allowed disabled:opacity-50";

type Common = { busy: boolean; error: string | null; onBack: () => void };

function Shell(
  p: Common & { submit: string; onSubmit: (f: FormData) => void; children: ReactNode },
) {
  const { t } = useTranslation();
  const go = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    p.onSubmit(new FormData(e.currentTarget));
  };
  return (
    <form onSubmit={go} className="flex flex-col gap-4">
      {p.children}
      {p.error && (
        <p role="alert" className="rounded-lg bg-late-bg px-3 py-2 text-sm text-late">
          {p.error}
        </p>
      )}
      <button type="submit" className={SUBMIT} disabled={p.busy}>
        {p.busy ? t("contracts.login.submitting") : p.submit}
      </button>
      <button type="button" className="text-[13px] font-semibold text-act" onClick={p.onBack}>
        {t("contracts.login.backToLogin")}
      </button>
    </form>
  );
}

const str = (f: FormData, k: string): string => String(f.get(k) ?? "");

export function ChangePasswordForm(
  p: Common & { onSubmit: (next: string, confirm: string) => void },
) {
  const { t } = useTranslation();
  return (
    <Shell
      {...p}
      submit={t("contracts.login.changeSubmit")}
      onSubmit={(f) => p.onSubmit(str(f, "next"), str(f, "confirm"))}
    >
      <label className="text-[13px]">
        {t("contracts.login.newPassword")}
        <input
          name="next"
          type="password"
          required
          className={AUTH_FIELD}
          autoComplete="new-password"
        />
      </label>
      <label className="text-[13px]">
        {t("contracts.login.confirmPassword")}
        <input
          name="confirm"
          type="password"
          required
          className={AUTH_FIELD}
          autoComplete="new-password"
        />
      </label>
    </Shell>
  );
}

export function TotpForm(p: Common & { onSubmit: (code: string) => void }) {
  const { t } = useTranslation();
  return (
    <Shell
      {...p}
      submit={t("contracts.login.totpSubmit")}
      onSubmit={(f) => p.onSubmit(str(f, "code"))}
    >
      <label className="text-[13px]">
        {t("contracts.login.code")}
        <input
          name="code"
          required
          className={`${AUTH_FIELD} font-mono`}
          autoComplete="one-time-code"
          inputMode="text"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
    </Shell>
  );
}
