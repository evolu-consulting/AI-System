// CHAT-AC-01, CHAT-AC-02 · CR-052 phương án C · màn Đăng nhập: cột trái 520px (logo + tên app, EN|VI, tiêu đề, form, ©) +
// cột phải showcase (≥ 1024px). Xong → `next` (đường nội bộ) hoặc `/c/new`.
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "~/app/i18n";
import { login } from "../api";
import { LockedDialog } from "../components/LockedDialog";
import { LoginForm, type LoginValues } from "../components/LoginForm";
import { LoginLayout } from "../components/LoginLayout";
import { LoginShowcase } from "../components/LoginShowcase";
import { ShowcaseWindow } from "../components/ShowcaseWindow";
import { type LoginOutcome, outcomeOfError, outcomeOfResponse } from "../lib/login-outcome";
import { safeNext } from "../lib/next";
import { normalizeLoginId, rememberedTenant, rememberTenant } from "../lib/tenant";

const loginRoute = getRouteApi("/login");

async function attempt(values: LoginValues): Promise<LoginOutcome> {
  const tenantKey = normalizeLoginId(values.tenant_key);
  try {
    const res = await login({
      tenant_key: tenantKey,
      username: normalizeLoginId(values.username),
      password: values.password,
    });
    rememberTenant(tenantKey);
    // CR-052: đăng nhập xong theo `user.locale` (như Admin).
    if (res.status === "authenticated") await i18n.changeLanguage(res.user.locale);
    return outcomeOfResponse(res);
  } catch (err) {
    return outcomeOfError(err);
  }
}

export function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const search = loginRoute.useSearch();
  const [defaultTenant] = useState(rememberedTenant);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const submit = async (values: LoginValues) => {
    setPending(true);
    setErrorKey(null);
    const outcome = await attempt(values);
    setPending(false);
    if (outcome.kind === "locked") return setLocked(true);
    if (outcome.kind === "alert") return setErrorKey(outcome.key);
    const next = safeNext(search.next);
    if (next) router.history.replace(next);
    else await router.navigate({ to: "/c/new", replace: true });
  };

  return (
    <LoginLayout
      appName={t("app.name")}
      showcase={
        <LoginShowcase tip="#f472b6">
          <ShowcaseWindow />
        </LoginShowcase>
      }
    >
      <div className="space-y-1.5">
        <h1 className="text-[28px] leading-9 font-bold text-foreground">{t("login.title")}</h1>
        <p className="text-[15px] text-muted-foreground">{t("login.subtitle")}</p>
      </div>
      <LoginForm
        defaultTenant={defaultTenant}
        pending={pending}
        error={errorKey ? t(errorKey) : null}
        onSubmit={submit}
      />
      <LockedDialog open={locked} onClose={() => setLocked(false)} />
    </LoginLayout>
  );
}
