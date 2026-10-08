// ADM-FR-01, ADM-FR-02, ADM-FR-08 · màn Đăng nhập (canvas Login): 2 cột (trái nền thương hiệu, phải form 380px); < 1024px ẩn cột trái.
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
import { LanguageSwitch } from "../components/LanguageSwitch";
import { LoginForm } from "../components/LoginForm";
import { LoginTotpStep } from "../components/totp/LoginTotpStep";
import { useTotpLogin } from "../hooks/use-totp-login";
import type { LoginValues } from "../lib/schemas";

const loginRoute = getRouteApi("/login");
const TENANT_STORAGE_KEY = "ai.tenantKey";
const BULLETS = ["auth.login.hero.b1", "auth.login.hero.b2", "auth.login.hero.b3"] as const;

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
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-primary-strong p-12 text-on-ink lg:flex">
        <img
          src="/brand/evoluconsulting-icon.svg"
          alt=""
          width={48}
          height={48}
          className="size-12"
        />
        <div className="space-y-6">
          <h2 className="max-w-md text-dialog-title font-semibold">{t("auth.login.hero.title")}</h2>
          <ul className="space-y-3 text-body">
            {BULLETS.map((key) => (
              <li key={key} className="flex gap-3">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-on-ink-link" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-caption">{t("auth.login.hero.footer")}</p>
      </aside>
      <main id="main" className="flex flex-col p-6">
        <div className="flex justify-end">
          <LanguageSwitch />
        </div>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center gap-6 py-8">
          <img
            src="/brand/evoluconsulting-logo-horizontal.svg"
            alt="EvoluConsulting"
            width={180}
            height={56}
            className="h-12 w-auto self-start"
          />
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
              <div className="space-y-1">
                <h1 className="text-page-title font-bold text-foreground">
                  {t("auth.login.title")}
                </h1>
                <p className="text-body text-muted-foreground">{t("auth.login.subtitle")}</p>
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
        </div>
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}
