// HD4 · ghi kết quả xử lý HĐ từ thẻ hạn (T-DEP-5: component chỉ trình bày, gọi API qua hook); xong ⇒ tải lại `queryKey`.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { postHandled } from "../api";
import type { Outcome } from "../lib/deadline";

export function useRecordHandled(contractId: string, queryKey: readonly unknown[]) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const record = async (o: Outcome) => {
    setBusy(true);
    setErr(false);
    try {
      await postHandled(contractId, o);
      await qc.invalidateQueries({ queryKey });
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, record };
}
