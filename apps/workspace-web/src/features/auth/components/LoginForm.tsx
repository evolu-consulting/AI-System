// PK-FR-10 · TF4 · form đăng nhập S01, port `reference/mgmt-app-contracts/web/src/pages/auth/LoginPage.tsx:39-63`.
// Lệch có chủ ý (D-21): ô "Mã công ty" chỉ khi chưa biết tenant; ô "Email" là tên đăng nhập admin-api (type text, không ép email).
// Nhãn e2e (plan-frontend §7): textbox "Mã công ty" / "Email" / "Mật khẩu", button "Hiện mật khẩu"/"Ẩn mật khẩu", "Đăng nhập".

import { Button } from "@ai/web-kit/ui/kit/button";
import { Input } from "@ai/web-kit/ui/kit/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
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

const _FIELD =
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
          <Input
            name="tenant_key"
            required
            defaultValue={tenant}
            className="font-mono"
            autoComplete="organization"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
      ) : (
        <p className="text-[13px] text-dim">
          {t("contracts.login.tenantKnown", { tenant })}{" "}
          <Button variant="link" className="h-auto px-0" onClick={() => setAskTenant(true)}>
            {t("contracts.login.changeTenant")}
          </Button>
        </p>
      )}
      <label className="text-[13px]">
        {t("contracts.login.email")}
        <Input
          name="username"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t("contracts.login.emailPlaceholder")}
        />
      </label>
      <label className="text-[13px]">
        {t("contracts.login.password")}
        <span className="relative mt-1 block">
          <Input
            name="password"
            type={show ? "text" : "password"}
            required
            className="mt-0 block pr-11"
            autoComplete="current-password"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="link"
                size="icon"
                className="absolute inset-y-0 right-0 h-auto w-11 text-dim hover:text-ink-2"
                onClick={() => setShow(!show)}
                aria-label={
                  show ? t("contracts.login.hidePassword") : t("contracts.login.showPassword")
                }
              >
                {show ? <IconEyeOff width={19} height={19} /> : <IconEye width={19} height={19} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {show ? t("contracts.login.hidePassword") : t("contracts.login.showPassword")}
            </TooltipContent>
          </Tooltip>
        </span>
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-late-bg px-3 py-2 text-sm text-late">
          {error}
        </p>
      )}
      <Button variant="primary" type="submit" className="h-11" disabled={busy}>
        {busy ? t("contracts.login.submitting") : t("contracts.login.submit")}
      </Button>
      <p className="text-[12.5px] text-dim">{t("contracts.login.forgot")}</p>
    </form>
  );
}
