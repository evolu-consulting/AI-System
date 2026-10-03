// ADM-FR-08 · ADM-FR-07 · M4-R16 · bước mã 2FA khi đăng nhập: gửi mã/mã dự phòng, ánh xạ lỗi (plan-frontend §8).
// INVALID_OTP → `auth.login.totp.wrong`; TEMP_LOCKED → "Tạm khoá đến hh:mm"; INVALID_TOTP_TOKEN → báo hết hạn, về form mật khẩu.
import { useState } from "react";
import { session, type TotpVerifyResponse } from "@/lib/auth/session";
import { describeLoginError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { verifyTotpLogin } from "../api";

type Options = {
  onDone: (res: TotpVerifyResponse) => Promise<void>;
  /** `totp_token` hết hạn/không hợp lệ: câu lỗi đã dịch để hiện ở form đăng nhập. */
  onExpired: (message: string) => void;
};

export type TotpLoginInput = { code: string } | { backup_code: string };

export function useTotpLogin({ onDone, onExpired }: Options) {
  const tr = useTr();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Trả `false` khi thất bại (nơi gọi xoá ô và focus lại). */
  const submit = async (input: TotpLoginInput): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await verifyTotpLogin(input);
      await onDone(res);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_TOTP_TOKEN") {
        session.clearPendingTotp();
        onExpired(tr("auth.login.totp.expired"));
        return false;
      }
      if (err instanceof ApiError && err.code === "INVALID_OTP") {
        setError(tr("auth.login.totp.wrong"));
      } else {
        const spec = describeLoginError(err);
        setError(tr(spec.key, spec.params));
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, setError, submit };
}
