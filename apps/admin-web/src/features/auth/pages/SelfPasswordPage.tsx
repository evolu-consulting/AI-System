// ADM-FR-06 · /account/password (tự đổi): card 480px; sai mật khẩu hiện tại → lỗi dưới ô; thành công → toast + quay lại.
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { changePasswordSelf } from "../api";
import { SelfPasswordForm, type SelfPasswordServerErrors } from "../components/SelfPasswordForm";
import type { SelfPasswordValues } from "../lib/schemas";

type Failure = { errors?: SelfPasswordServerErrors; toast?: string };

/** Lỗi server → lỗi dưới ô tương ứng; lỗi khác → toast; 401 để modal phiên hết hạn xử lý. */
function selfPasswordFailure(err: unknown, tr: ReturnType<typeof useTr>): Failure {
  const spec = describeError(err);
  const text = tr(spec.key, spec.params);
  const code = err instanceof ApiError ? err.code : "";
  if (code === "INVALID_CURRENT_PASSWORD" || code === "TEMP_LOCKED")
    return { errors: { current: text } };
  if (code === "PASSWORD_UNCHANGED") return { errors: { next: text } };
  return code === "UNAUTHORIZED" ? {} : { toast: text };
}

export function SelfPasswordPage() {
  const { t } = useTranslation();
  const tr = useTr();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<SelfPasswordServerErrors>({});

  const goBack = () => {
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: "/" });
  };

  const submit = async (values: SelfPasswordValues) => {
    setBusy(true);
    setServerErrors({});
    try {
      await changePasswordSelf(values.current_password, values.new_password);
      notifySuccess(t("password.toast.changedOthers"));
      goBack();
    } catch (err) {
      const failure = selfPasswordFailure(err, tr);
      if (failure.errors) setServerErrors(failure.errors);
      if (failure.toast) notifyError(failure.toast);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[480px]">
      <PageHeader title={t("password.self.title")} description={t("password.self.body")} />
      <SelfPasswordForm
        pending={busy}
        serverErrors={serverErrors}
        onCancel={goBack}
        onSubmit={submit}
      />
    </div>
  );
}
