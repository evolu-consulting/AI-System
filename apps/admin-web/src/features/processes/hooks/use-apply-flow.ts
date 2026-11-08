// CR-123 FLOW3-FR-10 · "Lưu và áp dụng": sau khi editor lưu def của công ty, gọi `POST …/company-flows/apply` — bản đó thành flow đang
// dùng của sự kiện (Hub: một tx, thay bản gốc). Trả trạng thái để thanh lưu nói rõ: đã áp dụng / chưa áp dụng / lỗi nghiệp vụ.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  applyCompanyFlow,
  companyFlowsKey,
  useCompanyFlowList,
} from "@/features/tenants/flows/company-flows-api";
import { errorKey } from "@/features/tenants/flows/lib/company-flow-view";
import { ApiError } from "@/lib/http";

export type ApplyStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "applied" }
  | { kind: "error"; key: string };

/** `tenantId` = công ty của def (vắng ⇒ không phải bản công ty: hook không làm gì). */
export function useApplyFlow(tenantId: string | null | undefined, flowId: string | undefined) {
  const qc = useQueryClient();
  const list = useCompanyFlowList(tenantId ?? "", !!tenantId);
  const [status, setStatus] = useState<ApplyStatus>({ kind: "idle" });
  const row = list.data?.items.find((x) => x.flow_id === flowId);
  /** Đã tải danh sách mà dòng chưa Bật (hoặc chưa có dòng) ⇒ còn việc "áp dụng". */
  const needsApply = !!tenantId && !!list.data && !row?.enabled;
  const apply = async (): Promise<boolean> => {
    if (!tenantId || !flowId) return false;
    setStatus({ kind: "pending" });
    try {
      qc.setQueryData(companyFlowsKey(tenantId), await applyCompanyFlow(tenantId, flowId));
      void qc.invalidateQueries({ queryKey: ["flow-settings", tenantId] }); // CR-125 · c2: áp dụng ⇒ cờ đã bật cùng giao dịch
      setStatus({ kind: "applied" });
      return true;
    } catch (e) {
      setStatus({ kind: "error", key: errorKey(e instanceof ApiError ? e.code : undefined) });
      return false;
    }
  };
  const reset = () => setStatus({ kind: "idle" });
  return { status, needsApply, apply, reset, active: !!tenantId };
}
