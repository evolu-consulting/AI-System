// PK-FR-10 · TF4 · form đăng nhập S01, port `reference/mgmt-app-contracts/web/src/pages/auth/LoginPage.tsx:39-63`.
// Lệch có chủ ý (D-21): ô "Mã công ty" chỉ khi chưa biết tenant; ô "Email" là tên đăng nhập admin-api (type text, không ép email).
// Nhãn e2e (plan-frontend §7): textbox "Mã công ty" / "Email" / "Mật khẩu", button "Hiện mật khẩu"/"Ẩn mật khẩu", "Đăng nhập".
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconEye, IconEyeOff } from "~/components/icons";

export type LoginValues = { tenant_key: string; username: string; password: string };

type Props = {
  /** Mã công ty biết trước ("" = phải hỏi). */
  tenant: string;
  busy: boolean;
  /** Câu lỗi đã dịch (vùng `role=alert`). */
  error: string | null;
  onSubmit: (values: LoginValues) => void;
};

const FIELD =
  "mt-1 h-10 w-full rounded-lg border border-field bg-panel px-3 text-sm text-ink focus:outline-2 focus:outline-act focus:-outline-offset-1";

export function LoginForm({ tenant, busy, error, onSubmit }: Props) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [askTenant, setAskTenant] = useState(tenant === "");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    onSubmit({
      tenant_key: askTenant ? String(f.get("tenant_key") ?? "") : tenant,
      username: String(f.get("username") ?? ""),
      password: String(f.get("password") ?? ""),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {askTenant ? (
        <label className="text-[13px]">
          {t("contracts.login.tenant")}
          <input
            name="tenant_key"
            required
            defaultValue={tenant}
            className={`${FIELD} font-mono`}
            autoComplete="organization"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
      ) : (
        <p className="text-[13px] text-dim">
          {t("contracts.login.tenantKnown", { tenant })}{" "}
          <button
            type="button"
            className="font-semibold text-act underline underline-offset-2"
            onClick={() => setAskTenant(true)}
          >
            {t("contracts.login.changeTenant")}
          </button>
        </p>
      )}
      <label className="text-[13px]">
        {t("contracts.login.email")}
        <input
          name="username"
          required
          className={FIELD}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t("contracts.login.emailPlaceholder")}
        />
      </label>
      <label className="text-[13px]">
        {t("contracts.login.password")}
        <span className="relative mt-1 block">
          <input
            name="password"
            type={show ? "text" : "password"}
            required
            className={`${FIELD} mt-0 block pr-11`}
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={
              show ? t("contracts.login.hidePassword") : t("contracts.login.showPassword")
            }
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-dim hover:text-ink-2"
          >
            {show ? <IconEyeOff width={19} height={19} /> : <IconEye width={19} height={19} />}
          </button>
        </span>
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-late-bg px-3 py-2 text-sm text-late">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="inline-flex h-11 items-center justify-center rounded-lg bg-act px-4 text-sm font-semibold text-on-act disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
      >
        {busy ? t("contracts.login.submitting") : t("contracts.login.submit")}
      </button>
      <p className="text-[12.5px] text-dim">{t("contracts.login.forgot")}</p>
    </form>
  );
}
