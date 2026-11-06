// CR-122 · U2 · client `/tenants/:tid/company-flows*` (E1b): đọc danh sách + bật/tắt, kéo thứ tự, sao chép, xuất bản, quay về bản gốc.
// Mỗi thao tác trả lại cả danh sách ⇒ ghi thẳng vào cache (vẽ lại một lần).
import type { CompanyFlowRow } from "@ai/contracts/hub-admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

const enc = encodeURIComponent;
const url = (tid: string, path = ""): string => {
  const u = hubUrl(`/tenants/${enc(tid)}/company-flows${path}`);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};
type List = { items: CompanyFlowRow[] };
const key = (tid: string) => ["company-flows", tid] as const;

export const useCompanyFlowList = (tid: string) =>
  useQuery({
    queryKey: key(tid),
    enabled: hubConfigured(),
    retry: false,
    queryFn: () => api<List>(url(tid)),
  });

export type FlowOp =
  | { op: "toggle"; id: string; enabled: boolean }
  | { op: "order"; ids: string[] }
  | { op: "assign"; flowId: string }
  | { op: "clone" | "publish" | "revert"; id: string };

function call(tid: string, a: FlowOp): Promise<List> {
  switch (a.op) {
    case "toggle":
      return api<List>(url(tid, `/${enc(a.id)}`), {
        method: "PATCH",
        body: { enabled: a.enabled },
      });
    case "assign":
      return api<List>(url(tid), { method: "POST", body: { flow_id: a.flowId } });
    case "order":
      return api<List>(url(tid, "/order"), { method: "PUT", body: { ids: a.ids } });
    default:
      return api<List>(url(tid, `/${enc(a.id)}/${a.op}`), { method: "POST", body: {} });
  }
}

/** Một thao tác lên danh sách; lỗi 409 ném lại cho UI đổi sang câu nghiệp vụ. */
export function useCompanyFlowOp(tid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: FlowOp) => call(tid, a),
    onSuccess: (list) => qc.setQueryData(key(tid), list),
    onError: () => qc.invalidateQueries({ queryKey: key(tid) }),
  });
}
