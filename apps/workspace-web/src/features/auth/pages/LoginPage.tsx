// PK-FR-10 · TF4 · CR-118 · màn Đăng nhập của web gộp (`/login?next=&tenant=`): bước mật khẩu (form contracts S01) → đổi mật khẩu
// bắt buộc lần đầu → mã TOTP (luồng `platform/auth`, như community-web) → `next` nội bộ mở được hoặc home theo quyền
// (đối tác ⇒ `/community`, có SHT ⇒ `/overview`). Thành viên SHT và đối tác dùng chung trang này + một phiên `contracts`.
import type { Me } from "@ai/contracts/chat";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "~/app/i18n";
import { ChangePasswordForm, currentCaps, landing, TotpForm, useLoginFlow } from "~/platform/auth";
import { AuthLayout } from "../components/AuthLayout";
import { LoginForm, type LoginValues } from "../components/LoginForm";
import { knownTenant, normalizeLoginId, rememberedTenant, rememberTenant } from "../lib/tenant";

const loginRoute = getRouteApi("/login");
const TITLES = {
  login: ["contracts.login.title", "contracts.login.subtitle"],
  change: ["contracts.login.changeTitle", "contracts.login.changeLead"],
  totp: ["contracts.login.totpTitle", "contracts.login.totpLead"],
  done: ["contracts.login.title", "contracts.login.subtitle"],
} as const;

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
  const [tenantUsed, setTenantUsed] = useState(tenant);

  const flow = useLoginFlow(async (user: Me) => {
    rememberTenant(tenantUsed);
    await i18n.changeLanguage(user.locale);
    router.history.replace(landing(await currentCaps(), search.next));
  });
  const error = flow.error ? t(flow.error.key, flow.error.params) : null;
  const [title, lead] = TITLES[flow.step.kind];

  const submitLogin = (v: LoginValues) => {
    const key = normalizeLoginId(v.tenant_key);
    setTenantUsed(key);
    void flow.submitLogin({
      tenant_key: key,
      username: normalizeLoginId(v.username),
      password: v.password,
    });
  };

  return (
    <AuthLayout>
      <div>
        <h1 className="text-[27px] font-bold tracking-[-0.01em]">{t(title)}</h1>
        <p className="mt-1.5 text-sm text-dim">{t(lead)}</p>
      </div>
      {flow.step.kind === "change" ? (
        <ChangePasswordForm
          busy={flow.busy}
          error={error}
          onBack={flow.restart}
          onSubmit={(n, c) => void flow.submitChange(n, c)}
        />
      ) : flow.step.kind === "totp" ? (
        <TotpForm
          busy={flow.busy}
          error={error}
          onBack={flow.restart}
          onSubmit={(c) => void flow.submitTotp(c)}
        />
      ) : (
        <LoginForm tenant={tenant} busy={flow.busy} error={error} onSubmit={submitLogin} />
      )}
    </AuthLayout>
  );
}
