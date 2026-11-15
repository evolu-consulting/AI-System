// CR-124 · q4 · truy vấn/ghi của khối hộp thư đối tác (component chỉ trình bày — T-DEP-5): vòng gửi, ghi nhận kết quả, cài đặt nhận.
import { ApiError } from "@ai/web-kit/http";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "~/features/auth/hooks/use-session";
import { isCompanyAdmin } from "~/features/shell/lib/nav";
import { fetchPartnerConfirm, fetchRounds, partnerKeys, type RecordIn, recordResult } from "../api";

/** Các vòng gửi đối tác của một HĐ (rỗng ⇒ HĐ chưa từng gửi). */
export function useRounds(contractId: string) {
  return useQuery({
    queryKey: partnerKeys.rounds(contractId),
    queryFn: ({ signal }) => fetchRounds(contractId, signal),
    retry: false,
  });
}

/** Ghi nhận kết quả đối tác cho một vòng; xong ⇒ làm mới hộp thư + gọi `onDone`. `error` = câu hiển thị (từ server hoặc câu chung). */
export function useRecordResult(mailboxId: string, onDone: () => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: RecordIn) => recordResult(mailboxId, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["contracts", "partner"] });
      onDone();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : t("contracts.partner.record.fail")),
  });
  return { mutate: m.mutate, isPending: m.isPending, error };
}

/** CR-125 · UX-S7 · điều kiện «Đối tác xác nhận hợp đồng» của công ty mình; chỉ quản trị công ty (owner) đọc. Lỗi ⇒ không hiện (không chặn Cài đặt). */
export function usePartnerConfirmStatus(owner: boolean) {
  const me = useSession((s) => s.me);
  const tenantId = me?.tenant.id ?? null;
  const q = useQuery({
    queryKey: ["contracts", "partner", "confirm", tenantId],
    queryFn: () => fetchPartnerConfirm(tenantId as string),
    enabled: owner && tenantId !== null && isCompanyAdmin(me?.role),
    retry: false,
  });
  return q.data ?? null;
}
