// ADM-FR-06 · /change-password (bắt buộc): card 400px ngoài khung; token hết hạn thay form bằng alert + "Đăng nhập lại".
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { BareLayout } from "@/features/shell/components/BareLayout";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { session } from "@/lib/session";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useSession } from "@/lib/use-session";
import { useTr } from "@/lib/use-translate";
import { changePasswordForced } from "../api";
import { ForcedPasswordForm } from "../components/ForcedPasswordForm";
import type { ForcedPasswordValues } from "../lib/schemas";

export function ForcedPasswordPage() {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const router = useRouter();
  const pending = useSession((s) => s.pendingChange);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [newError, setNewError] = useState<string>();
  useDocumentTitle(t("password.forced.title"));

  const toLogin = async () => {
    session.clearPendingChange();
    await router.navigate({ to: "/login", search: {} });
  };

  const submit = async (values: ForcedPasswordValues) => {
    setBusy(true);
    setNewError(undefined);
    try {
      const me = await changePasswordForced(values.new_password);
      notifySuccess(t("password.toast.changed"));
      await i18n.changeLanguage(me.locale);
      await router.navigate({ to: me.role === "member" ? "/member" : "/" });
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_CHANGE_TOKEN") {
        setExpired(true);
      } else {
        const spec = describeError(err);
        setNewError(tr(spec.key, spec.params));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <BareLayout>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-page-title font-bold text-foreground">
            {t("password.forced.title")}
          </h1>
          {pending ? (
            <p className="font-mono text-body text-muted-foreground">
              {pending.tenantKey} · {pending.username}
            </p>
          ) : null}
          <p className="text-body text-muted-foreground">{t("password.forced.body")}</p>
        </div>
        {expired ? (
          <div className="space-y-4">
            <p role="alert" className="rounded-md bg-warning-bg px-3 py-2 text-label text-warning">
              {t("password.error.tokenExpired")}
            </p>
            <Button className="w-full" onClick={toLogin}>
              {t("password.relogin")}
            </Button>
          </div>
        ) : (
          <>
            <ForcedPasswordForm pending={busy} newPasswordError={newError} onSubmit={submit} />
            <Button variant="link" className="px-0" onClick={toLogin}>
              {t("auth.logout")}
            </Button>
          </>
        )}
      </div>
    </BareLayout>
  );
}
