// HUB-FR-72 · H4a-R14 · CR-052 phương án C · màn Đăng nhập Studio (Agent Forge): cột trái form 520px + cột phải showcase; bước TOTP (QF2).
// Thành công → `next` (đã kiểm chống open redirect) hoặc /agents; guard `_authed` kiểm role bằng `me`.
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { safeNext } from "#/lib/auth/next";
import { ADMIN_URL, withBase } from "#/lib/env";
import { readLocal, writeLocal } from "#/lib/storage";
import { login, verifyTotp } from "../api";
import { LoginForm, type LoginValues } from "../components/LoginForm";
import { LoginLayout } from "../components/LoginLayout";
import { LoginShowcase } from "../components/LoginShowcase";
import { ShowcaseWindow } from "../components/ShowcaseWindow";
import { TotpForm, type TotpInput } from "../components/TotpForm";
import { classifyTotpError, describeLoginError, type MessageSpec } from "../lib/login-error";

const loginRoute = getRouteApi("/login");
const TENANT_STORAGE_KEY = "studio.tenantKey";

type PendingTotp = { token: string; account: string };

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const search = loginRoute.useSearch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [totp, setTotp] = useState<PendingTotp | null>(null);
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);

  const tr = (spec: MessageSpec) => t(spec.key, spec.params);

  // CR-052: đăng nhập xong theo `user.locale` (như Admin), không giữ ngôn ngữ chọn ở màn login.
  const finish = async (locale: string) => {
    await i18n.changeLanguage(locale);
    const next = safeNext(search.next);
    if (next) await router.navigate({ href: withBase(next), replace: true });
    else await router.navigate({ to: "/agents", replace: true });
  };

  const submit = async (values: LoginValues) => {
    setPending(true);
    setError(null);
    setMustChange(false);
    try {
      const res = await login(values);
      writeLocal(TENANT_STORAGE_KEY, values.tenant_key);
      if (res.status === "totp_required") {
        setTotpError(null);
        setTotp({ token: res.totp_token, account: `${values.tenant_key} · ${values.username}` });
      } else if (res.status === "password_change_required") {
        setMustChange(true);
      } else {
        await finish(res.user.locale);
      }
    } catch (err) {
      setError(tr(describeLoginError(err)));
    } finally {
      setPending(false);
    }
  };

  const submitTotp = async (input: TotpInput): Promise<boolean> => {
    if (!totp || totpBusy) return false;
    setTotpBusy(true);
    setTotpError(null);
    try {
      const res = await verifyTotp({ totp_token: totp.token, ...input });
      if (res.status === "password_change_required") {
        setTotp(null);
        setMustChange(true);
      } else {
        await finish(res.user.locale);
      }
      return true;
    } catch (err) {
      const out = classifyTotpError(err);
      if (out.kind === "expired") {
        setTotp(null);
        setError(t("login.totp.expired"));
      } else {
        setTotpError(out.kind === "wrong" ? t("login.totp.wrong") : tr(out.spec));
      }
      return false;
    } finally {
      setTotpBusy(false);
    }
  };

  return (
    <LoginLayout
      appName={t("app.name")}
      showcase={
        <LoginShowcase tip="#fbbf24">
          <ShowcaseWindow />
        </LoginShowcase>
      }
    >
      {totp ? (
        <TotpForm
          account={totp.account}
          busy={totpBusy}
          error={totpError}
          onError={setTotpError}
          onSubmit={submitTotp}
          onBack={() => {
            setTotp(null);
            setTotpError(null);
          }}
        />
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-accent px-3 py-1 text-caption font-semibold text-accent-foreground">
            <Lock aria-hidden="true" className="size-3.5" />
            {t("login.adminOnly")}
          </span>
          <div className="space-y-1.5">
            <h1 className="text-[28px] leading-9 font-bold text-foreground">{t("login.title")}</h1>
            <p className="text-[15px] text-muted-foreground">{t("login.subtitle")}</p>
          </div>
          {mustChange ? (
            <Alert className="border-warning-solid bg-warning-bg text-warning">
              <AlertDescription>
                {t("login.mustChange")}
                {ADMIN_URL ? (
                  <>
                    {" "}
                    <a href={ADMIN_URL} className="font-medium underline underline-offset-4">
                      {t("topbar.toAdmin")}
                    </a>
                  </>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <LoginForm
            defaultTenant={readLocal(TENANT_STORAGE_KEY) ?? ""}
            pending={pending}
            error={error}
            onSubmit={(v) => void submit(v)}
          />
          {ADMIN_URL ? (
            <p className="text-label text-muted-foreground">
              {t("login.notAdmin")}{" "}
              <a href={ADMIN_URL} className="text-primary-strong underline underline-offset-4">
                {t("login.openAdmin")}
              </a>
            </p>
          ) : null}
        </>
      )}
    </LoginLayout>
  );
}
