// HD7-FR-12 · `act` của PartnerLog (mgmt `PartnerLog.tsx:57-68`): chạy một lệnh, làm mới mọi truy vấn đối tác, báo toast; lỗi giữ
// nguyên điều đã gõ (trả false) và hiện câu theo mã API.
import { ApiError } from "@ai/web-kit/http";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { LEDGER_ERRORS } from "./ledger";

export type Act = (key: string, f: () => Promise<unknown>, okMsg?: string) => Promise<boolean>;

export function ledgerErrorText(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) {
    if (LEDGER_ERRORS.includes(e.code)) return t(`contracts.ledger.errors.${e.code}`);
    if (e.code === "NETWORK_ERROR") return t("contracts.errors.network");
  }
  return t("contracts.errors.unknown");
}

export function useAct(onChange?: () => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const act: Act = async (key, f, okMsg) => {
    setErr(null);
    setBusy(key);
    try {
      await f();
      await qc.invalidateQueries({ queryKey: ["partners"] });
      onChange?.();
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      setErr(ledgerErrorText(e, t));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { act, err, busy };
}
