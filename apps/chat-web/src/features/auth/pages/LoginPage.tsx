// CHAT-AC-01, CHAT-AC-02 · màn Đăng nhập: bố cục Login của Admin bỏ cột thương hiệu (plan-frontend §5) — logo ngang,
// tiêu đề, form 380px giữa trang. Xong → `next` (đường nội bộ) hoặc `/c/new`.
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "~/components/shared/BrandLogo";
import { login } from "../api";
import { LockedDialog } from "../components/LockedDialog";
import { LoginForm, type LoginValues } from "../components/LoginForm";
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
    <main id="main" className="flex min-h-screen flex-col bg-background p-6">
      <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center gap-6 py-8">
        <BrandLogo className="self-start" imgClassName="h-12 w-auto" />
        <div className="space-y-1">
          <h1 className="text-page-title font-bold text-foreground">{t("login.title")}</h1>
          <p className="text-body text-muted-foreground">{t("login.subtitle")}</p>
        </div>
        <LoginForm
          defaultTenant={defaultTenant}
          pending={pending}
          error={errorKey ? t(errorKey) : null}
          onSubmit={submit}
        />
      </div>
      <LockedDialog open={locked} onClose={() => setLocked(false)} />
    </main>
  );
}
