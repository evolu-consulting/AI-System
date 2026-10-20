// PK-FR-10 · TF4 · màn Đăng nhập S01 (`/login?next=&tenant=`) — port `reference/mgmt-app-contracts/web/src/pages/auth/LoginPage.tsx:10-73`
// (bỏ đăng ký/onboarding, D-21). Gọi admin-api `/auth/login` qua web-kit; xong → `next` (đường nội bộ) hoặc `/contracts`.
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "~/app/i18n";
import { login } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { LoginForm, type LoginValues } from "../components/LoginForm";
import { type LoginOutcome, outcomeOfError, outcomeOfResponse } from "../lib/login-outcome";
import { safeNext } from "../lib/next";
import { knownTenant, normalizeLoginId, rememberedTenant, rememberTenant } from "../lib/tenant";

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
  const [tenant] = useState(() =>
    knownTenant({
      search: search.tenant,
      env: import.meta.env.PUBLIC_TENANT_KEY,
      remembered: rememberedTenant(),
    }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LoginOutcome>(null);

  const submit = async (values: LoginValues) => {
    setBusy(true);
    setError(null);
    const outcome = await attempt(values);
    setBusy(false);
    if (outcome) return setError(outcome);
    const next = safeNext(search.next);
    if (next) router.history.replace(next);
    else await router.navigate({ to: "/overview", replace: true });
  };

  return (
    <AuthLayout>
      <div>
        <h1 className="text-[27px] font-bold tracking-[-0.01em]">{t("contracts.login.title")}</h1>
        <p className="mt-1.5 text-sm text-dim">{t("contracts.login.subtitle")}</p>
      </div>
      <LoginForm
        tenant={tenant}
        busy={busy}
        error={error ? t(error.key, error.params) : null}
        onSubmit={submit}
      />
    </AuthLayout>
  );
}
