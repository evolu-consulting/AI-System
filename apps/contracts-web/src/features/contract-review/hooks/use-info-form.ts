// V2-F · HD-09 · S05: trạng thái form "Thông tin" của HĐ đã lưu — bản nháp từ chi tiết, chỉ PATCH ô đã đổi (khoá `version`), "Hủy" = trả
// về giá trị đã lưu. "Xác nhận" (HD3) lưu ô đã đổi trước rồi quyết cấp 1 (`saveFirst`).
import type { ContractDetail } from "@ai/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formOfDetail, patchOfForm } from "~/features/contract-form/lib/detail-form";
import type { FormState, TextKey } from "~/features/contract-form/lib/form-model";
import { contractKey, patchContractFields } from "../api";
import { saveErrorText } from "../lib/save-error";

export function useInfoForm(c: ContractDetail | undefined, id: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState<FormState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (c) setF(formOfDetail(c));
  }, [c]);

  const patch = useMemo(() => (c && f ? patchOfForm(c, f) : {}), [c, f]);
  const dirty = Object.keys(patch).length > 0;
  const set = useCallback((k: TextKey, v: string) => setF((s) => (s ? { ...s, [k]: v } : s)), []);
  const reset = useCallback(() => {
    if (c) setF(formOfDetail(c));
    setErr(null);
    setMsg(null);
  }, [c]);

  /** Chỉ ghi khi có ô đổi; ném lỗi cho người gọi khi `throws` (luồng "Xác nhận"). */
  const saveFirst = useCallback(async () => {
    if (c && Object.keys(patch).length) await patchContractFields(id, c.version, patch);
  }, [c, patch, id]);

  const save = useCallback(async () => {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      await saveFirst();
      await qc.invalidateQueries({ queryKey: contractKey(id) });
      setMsg(t("contracts.review.saved"));
    } catch (e) {
      setErr(saveErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }, [saveFirst, qc, id, t]);

  return { f, set, dirty, reset, save, saveFirst, busy, msg, err };
}
