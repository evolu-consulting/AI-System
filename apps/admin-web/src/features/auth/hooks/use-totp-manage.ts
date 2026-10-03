// ADM-FR-08 · plan-frontend §8 · Tắt 2FA / Tạo lại mã dự phòng khi đã bật: sai mật khẩu hoặc mã → `twofa.error.wrongCreds`.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { totpDisable, totpRegenerate } from "../api";
import type { TotpConfirmValues } from "../lib/totp-steps";
import { reloadMe } from "./use-totp-setup";

export type ManageDialog = "disable" | "regen" | null;

const WRONG = new Set(["INVALID_CURRENT_PASSWORD", "INVALID_CURRENT_CODE"]);

/** `onCodes`: nhận 10 mã mới sau khi tạo lại (trang chuyển sang bước Lưu mã dự phòng). */
export function useTotpManage(onCodes: (codes: string[]) => void) {
  const { t } = useTranslation();
  const tr = useTr();
  const [dialog, setDialog] = useState<ManageDialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (d: ManageDialog) => {
    setError(null);
    setDialog(d);
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setDialog(null);
    } catch (err) {
      if (err instanceof ApiError && WRONG.has(err.code)) setError(t("twofa.error.wrongCreds"));
      else {
        const spec = describeError(err);
        setError(tr(spec.key, spec.params));
      }
    } finally {
      setBusy(false);
    }
  };

  const disable = ({ password, code }: TotpConfirmValues) =>
    run(async () => {
      await totpDisable({ current_password: password, code });
      await reloadMe();
      notifySuccess(t("twofa.toast.disabled"));
    });

  const regenerate = ({ code }: TotpConfirmValues) =>
    run(async () => {
      const r = await totpRegenerate(code);
      await reloadMe();
      onCodes(r.backup_codes);
      notifySuccess(t("twofa.toast.regenerated"));
    });

  return { dialog, open, busy, error, disable, regenerate };
}
