// HUB-FR-72 · H4a-R14 · màn Đăng nhập Studio (mẫu Admin ui-admin §7.1, bỏ hero, logo "✦ Agent Studio") + bước TOTP (QF2).
// Thành công → `next` (đã kiểm chống open redirect) hoặc /agents; guard `_authed` kiểm role bằng `me`.
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { safeNext } from "#/lib/auth/next";
import { ADMIN_URL, withBase } from "#/lib/env";
import { readLocal, writeLocal } from "#/lib/storage";
import { useDocumentTitle } from "#/lib/use-document-title";
import { login, verifyTotp } from "../api";
import { LoginForm, type LoginValues } from "../components/LoginForm";
import { TotpForm, type TotpInput } from "../components/TotpForm";
import { classifyTotpError, describeLoginError, type MessageSpec } from "../lib/login-error";

const loginRoute = getRouteApi("/login");
const TENANT_STORAGE_KEY = "studio.tenantKey";

type PendingTotp = { token: string; account: string };

export function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const search = loginRoute.useSearch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [totp, setTotp] = useState<PendingTotp | null>(null);
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  useDocumentTitle(t(totp ? "login.totp.title" : "login.title"));

  const tr = (spec: MessageSpec) => t(spec.key, spec.params);

  const finish = async () => {
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
        await finish();
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
        await finish();
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
    <main id="main" className="flex min-h-screen flex-col bg-background p-6">
      <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center gap-6 py-8">
        <span className="text-card-title font-bold text-primary-strong">{t("app.name")}</span>
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
            <div className="space-y-1">
              <h1 className="text-page-title font-bold text-foreground">{t("login.title")}</h1>
              <p className="text-body text-muted-foreground">{t("login.subtitle")}</p>
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
          </>
        )}
      </div>
    </main>
  );
}
