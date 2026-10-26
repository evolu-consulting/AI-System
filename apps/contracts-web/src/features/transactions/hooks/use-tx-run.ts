// CR-097 G2: chạy một thao tác ghi (lưu/ghi sổ/điều chỉnh/huỷ…) — cờ bận, câu lỗi theo mã máy chủ, làm mới cache Giao dịch.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { TX_KEY } from "../api";
import { txErrorText } from "../lib/transactions";

export function useTxRun() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Trả kết quả hoặc `undefined` khi lỗi (câu lỗi nằm ở `error`). */
  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        await qc.invalidateQueries({ queryKey: TX_KEY });
        // Kho đổi ⇒ danh mục SP (tồn) cũng cũ.
        await qc.invalidateQueries({ queryKey: ["products"] });
        return r;
      } catch (e) {
        setError(txErrorText(e, t));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [qc, t],
  );
  return { busy, error, setError, run };
}
