// ADM-FR-08 · M4-R16 · plan-frontend §3.6, §8, D11 · điều phối luồng bật 2FA và bước lưu mã dự phòng.
// Secret/mã dự phòng chỉ ở state của hook (không cache/URL/storage); reset là xoá.
import { useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { session } from "@/lib/auth/session";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { totpEnable, totpSetup } from "../api";
import { TOTP_IDLE, totpReducer } from "../lib/totp-steps";

const codeOf = (err: unknown): string => (err instanceof ApiError ? err.code : "");

/** Tải lại hồ sơ (`totp_enabled`, `backup_codes_left`); lỗi thì bỏ qua — lần tải sau sẽ đúng. */
export async function reloadMe(): Promise<void> {
  try {
    await session.reload();
  } catch {
    // giữ hồ sơ cũ
  }
}

/** Chạy một bước gọi API: khoá nút, lỗi sai mật khẩu/mã → `wrongKey`; phiên thiết lập hết hạn → `onExpired`. */
function useStepRunner(onExpired: () => void) {
  const { t } = useTranslation();
  const tr = useTr();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown, wrongKey: string) => {
    const code = codeOf(err);
    if (code === "TOTP_SETUP_EXPIRED") {
      notifyError(t("twofa.error.setupExpired"));
      onExpired();
    } else if (code === "INVALID_CURRENT_PASSWORD" || code === "INVALID_CURRENT_CODE") {
      setError(t(wrongKey));
    } else {
      const spec = describeError(err);
      setError(tr(spec.key, spec.params));
    }
  };

  const run = async (work: () => Promise<void>, wrongKey: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      fail(err, wrongKey);
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, setError, run };
}

export function useTotpSetup() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(totpReducer, TOTP_IDLE);
  const { busy, error, setError, run } = useStepRunner(() => dispatch({ type: "reset" }));

  const submitPassword = (password: string) =>
    run(async () => {
      const r = await totpSetup(password);
      dispatch({
        type: "setupLoaded",
        setup: { secret: r.secret, otpauth_url: r.otpauth_url, qr_svg: r.qr_svg },
      });
    }, "password.error.currentWrong");

  const submitCode = (code: string) =>
    run(async () => {
      const r = await totpEnable(code);
      await reloadMe();
      dispatch({ type: "codesIssued", codes: r.backup_codes, source: "enable" });
    }, "twofa.verify.wrong");

  const go = (type: "start" | "next" | "back" | "reset") => {
    setError(null);
    dispatch({ type });
  };

  /** Hoàn tất bước lưu mã: xoá mã khỏi bộ nhớ; bật lần đầu thì toast. */
  const finish = () => {
    if (state.step === "backup" && state.source === "enable") {
      notifySuccess(t("twofa.toast.enabled"));
    }
    go("reset");
  };

  const showCodes = (codes: string[]) => dispatch({ type: "codesIssued", codes, source: "regen" });

  return { state, busy, error, submitPassword, submitCode, go, finish, showCodes };
}
