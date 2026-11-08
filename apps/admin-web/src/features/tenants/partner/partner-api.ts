// CR-125 · UX-S7 (H7) · client "Đối tác xác nhận hợp đồng": đọc danh sách điều kiện + bật/tắt (admin-api), và các nút "Làm bước này" dùng ĐÚNG đường có sẵn:
// Gán mẫu Thư viện (Hub company-flows) và Tạo nhóm theo gợi ý (admin-api template-fixes) — không đường thứ hai.
import type { PartnerChecklist } from "@ai/contracts/modules";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { useCompanyFlowOp } from "../flows/company-flows-api";

const enc = encodeURIComponent;
const key = (tid: string) => ["tenants", "partner-confirm", tid] as const;

export const usePartnerConfirm = (tid: string) =>
  useQuery({
    queryKey: key(tid),
    retry: false,
    queryFn: () => api<PartnerChecklist>(`/admin/tenants/${enc(tid)}/partner-confirm`),
  });

/** Sau mỗi thao tác: đọc lại danh sách + bảng ứng dụng (entitlement đổi) + danh sách flow. */
function useRefresh(tid: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: key(tid) }),
      qc.invalidateQueries({ queryKey: ["tenants", "feature-states", tid] }),
      qc.invalidateQueries({ queryKey: ["company-flows", tid] }),
    ]);
}

/** Công tắc bật/tắt tính năng (platform). */
export function useSetPartnerConfirm(tid: string) {
  const refresh = useRefresh(tid);
  return useMutation({
    mutationFn: (on: boolean) =>
      api<PartnerChecklist>(`/admin/tenants/${enc(tid)}/partner-confirm`, {
        method: "PUT",
        body: { on },
      }),
    onSettled: refresh,
  });
}

/** Nút "Làm bước này" không phải chuyển màn: gán flow nhận · tạo nhóm theo gợi ý. */
export function usePartnerFix(tid: string) {
  const refresh = useRefresh(tid);
  const assign = useCompanyFlowOp(tid);
  return useMutation({
    mutationFn: async (
      a: { fix: "assign-receive-flow"; flowId: string } | { fix: "create-group"; groupKey: string },
    ) => {
      if (a.fix === "assign-receive-flow")
        return assign.mutateAsync({ op: "assign", flowId: a.flowId });
      return api<unknown>(`/admin/tenants/${enc(tid)}/template-fixes/create-group`, {
        method: "POST",
        body: { group_key: a.groupKey },
      });
    },
    onSettled: refresh,
  });
}
