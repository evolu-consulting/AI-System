// CR-152 · trường riêng của Nhượng quyền / Hợp tác ở màn HĐ đã lưu: nạp (GET), điền sẵn từ AI, ghi (PUT), ô thiếu/AI chưa chắc.
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { FormState } from "~/features/contract-form/lib/form-model";
import {
  isKind,
  termsDirty,
  termsMissing,
  termsOfServer,
  termsToPut,
  unsureTerms,
} from "~/features/contract-form/lib/kind-terms";
import { fetchKindTerms, kindTermsKey, putKindTerms } from "../api";

/** CR-152: trường riêng đã lưu (GET kind-terms) nạp vào form; ghi lại bằng PUT khi HĐ còn nháp. */
export function useKindTerms(
  c: ContractDetail | undefined,
  id: string,
  L: {
    setF: Dispatch<SetStateAction<FormState | null>>;
    sug: number;
    f: FormState | null;
    tried: boolean;
  },
) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: kindTermsKey(id),
    queryFn: ({ signal }) => fetchKindTerms(id, signal),
    enabled: !!c && isKind(c.deal),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const saved = useMemo(() => termsOfServer(q.data?.terms), [q.data]);
  const { setF, sug, f } = L;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại mỗi lần form nạp lại (`sug`) hoặc dữ liệu đã lưu đổi
  useEffect(() => {
    // CR-171: chưa ghi gì + bước xác nhận ⇒ điền sẵn các ô AI đọc được (trước đây form trắng dù AI đã đọc ra).
    const fromAi = c?.status === "draft" && c.ai !== null && Object.keys(saved).length === 0;
    if (q.data)
      setF((s) => (s ? { ...s, terms: fromAi ? termsOfServer(c?.ai?.kind_terms) : saved } : s));
  }, [saved, sug]);
  const deal = f?.deal;
  const draft = c?.status === "draft";
  const changed = !!f && isKind(deal) && draft && termsDirty(deal, f.terms, saved);
  const save = useCallback(async () => {
    if (!f || !isKind(f.deal) || !draft) return;
    const { body, bad } = termsToPut(f.deal, f.terms);
    if (bad.length) {
      const msg = t("contracts.kinds.badNumbers", {
        list: bad.map((k) => t(`contracts.kinds.f.${k}`)).join(", "),
      });
      toast(msg, "late");
      throw new Error(msg);
    }
    await putKindTerms(id, body);
    await qc.invalidateQueries({ queryKey: kindTermsKey(id) });
  }, [f, draft, id, qc, t]);
  const unsure = useMemo(
    () => (f && isKind(f.deal) ? unsureTerms(c?.ai?.unsure, f.terms, saved) : new Set<string>()),
    [c, f, saved],
  );
  // CR-171: ô viền đỏ theo CHÍNH form đang sửa (cùng luật máy chủ), không theo bản đã lưu cũ.
  const invalid = useMemo(
    () =>
      L.tried && f && isKind(f.deal) ? new Set(termsMissing(f.deal, f.terms)) : new Set<string>(),
    [L.tried, f],
  );
  return { save, changed, unsure, invalid };
}
