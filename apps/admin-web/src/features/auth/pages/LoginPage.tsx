// ADM-FR-01, ADM-FR-02, ADM-FR-08 · CR-052 phương án C · màn Đăng nhập (Evolu Control): cột trái form 520px + cột phải showcase; < 1024px ẩn cột phải.
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Toaster } from "@/components/ui/sonner";
import { safeNext } from "@/lib/auth/next";
import { session, type TotpVerifyResponse } from "@/lib/auth/session";
import { useSession } from "@/lib/auth/use-session";
import { describeLoginError } from "@/lib/errors";
import { normalizeCompanyKey, normalizeUsername } from "@/lib/normalize";
import { useTr } from "@/lib/use-translate";

import { login } from "../api";
import { LoginForm } from "../components/LoginForm";
import { LoginLayout } from "../components/LoginLayout";
import { LoginShowcase } from "../components/LoginShowcase";
import { ShowcaseWindow } from "../components/ShowcaseWindow";
import { LoginTotpStep } from "../components/totp/LoginTotpStep";
import { useTotpLogin } from "../hooks/use-totp-login";
import type { LoginValues } from "../lib/schemas";

const loginRoute = getRouteApi("/login");
const TENANT_STORAGE_KEY = "ai.tenantKey";
const CHAT_APP_URL = import.meta.env.PUBLIC_CHAT_APP_URL;

function rememberedTenant(search: { tenant?: string }): string {
  return search.tenant ?? localStorage.getItem(TENANT_STORAGE_KEY) ?? "";
}

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const router = useRouter();
  const search = loginRoute.useSearch();
  const pendingTotp = useSession((s) => s.pendingTotp);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUsername, setLastUsername] = useState("");

  const finish = async (res: TotpVerifyResponse) => {
    if (res.status === "password_change_required") {
      await router.navigate({ to: "/change-password" });
      return;
    }
    await i18n.changeLanguage(res.user.locale);
    const next = safeNext(search.next);
    if (next) router.history.push(next);
    else await router.navigate({ to: res.user.role === "member" ? "/member" : "/" });
  };
  const totp = useTotpLogin({ onDone: finish, onExpired: setError });

  const submit = async (values: LoginValues) => {
    setPending(true);
    setError(null);
    const tenantKey = normalizeCompanyKey(values.tenant_key);
    const username = normalizeUsername(values.username);
    setLastUsername(username);
    try {
      const res = await login({ tenant_key: tenantKey, username, password: values.password });
      localStorage.setItem(TENANT_STORAGE_KEY, tenantKey);
      if (res.status === "totp_required") {
        totp.setError(null);
        return;
      }
      await finish(res);
    } catch (err) {
      const spec = describeLoginError(err);
      setError(tr(spec.key, spec.params));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <LoginLayout
        appName={t("auth.login.appName")}
        showcase={
          <LoginShowcase tip="#67e8f9">
            <ShowcaseWindow />
          </LoginShowcase>
        }
      >
        {pendingTotp ? (
          <LoginTotpStep
            tenantKey={pendingTotp.tenantKey}
            username={pendingTotp.username}
            busy={totp.busy}
            error={totp.error}
            onError={totp.setError}
            onSubmit={totp.submit}
            onBack={session.clearPendingTotp}
          />
        ) : (
          <>
            <div className="space-y-1.5">
              <h1 className="text-[28px] leading-9 font-bold text-foreground">
                {t("auth.login.title")}
              </h1>
              <p className="text-[15px] text-muted-foreground">{t("auth.login.subtitle")}</p>
            </div>
            <LoginForm
              defaultTenant={rememberedTenant(search)}
              defaultUsername={lastUsername}
              pending={pending}
              error={error}
              onSubmit={submit}
            />
          </>
        )}
        {pendingTotp || !CHAT_APP_URL ? null : (
          <p className="text-label text-muted-foreground">
            {t("auth.login.memberLink")}{" "}
            <a href={CHAT_APP_URL} className="text-primary-strong underline underline-offset-4">
              {t("auth.login.openChat")}
            </a>
          </p>
        )}
      </LoginLayout>
      <Toaster position="bottom-right" />
    </>
  );
}
