// CR-121 · R-3: gọi Hub cho trang "Chi tiết lượt chạy": `GET /process-runs/:id/detail`, `GET …/stages/:idx/log`,
// `POST …/{stop,rerun-step,rerun}` (lý do enum bắt buộc; platform_admin gửi `?tenant_id`).
import type {
  RerunProcessRunRequest,
  RerunStepRequest,
  RunControlReason,
  RunDetail,
  RunSource,
  RunStageLog,
  StopProcessRunRequest,
} from "@ai/contracts/chat";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMyApps } from "@/features/shell/api";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";
import { contractLink, isRunEnded } from "./lib/run-detail-view";

const POLL_MS = 5000;
const enc = encodeURIComponent;
const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};

export const RUN_DETAIL_KEYS = {
  detail: (id: string, tenantId?: string) => ["process", "run-detail", id, tenantId ?? ""] as const,
  log: (id: string, idx: number, tenantId?: string) =>
    ["process", "run-detail-log", id, idx, tenantId ?? ""] as const,
};

/** Làm tươi định kỳ tới khi lượt kết thúc (chưa có stream ở admin). */
export function useRunDetail(id: string, tenantId: string | undefined) {
  return useQuery({
    queryKey: RUN_DETAIL_KEYS.detail(id, tenantId),
    enabled: hubConfigured(),
    refetchInterval: (q) => (q.state.data && isRunEnded(q.state.data.status) ? false : POLL_MS),
    queryFn: () =>
      api<RunDetail>(url(`/process-runs/${enc(id)}/detail`), { query: { tenant_id: tenantId } }),
  });
}

export function useStageLog(id: string, idx: number | null, tenantId: string | undefined) {
  return useQuery({
    queryKey: RUN_DETAIL_KEYS.log(id, idx ?? -1, tenantId),
    enabled: hubConfigured() && idx !== null,
    queryFn: () =>
      api<RunStageLog>(url(`/process-runs/${enc(id)}/stages/${idx ?? 0}/log`), {
        query: { tenant_id: tenantId },
      }),
  });
}

/** URL app lấy từ `GET /me/apps` (cùng nguồn switcher); không có app ⇒ `null` (không hiện liên kết). */
export function useSourceHref(source: RunSource | null): string | null {
  const q = useQuery({
    queryKey: ["process", "my-apps"] as const,
    enabled: source?.kind === "contract",
    staleTime: 5 * 60_000,
    queryFn: fetchMyApps,
  });
  if (source?.kind !== "contract") return null;
  return contractLink(q.data?.find((a) => a.key === source.app_key)?.url, source.id);
}

/** "Mở lại quy trình" của hợp đồng: API hiện có của gói (`reason` là câu chữ của lý do đã chọn). */
export function useReopenContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { contractId: string; reason: string }) =>
      api<unknown>(url(`/pack/contracts/contracts/${enc(a.contractId)}/reopen`), {
        method: "POST",
        body: { reason: a.reason },
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["process"] }),
  });
}

export type RunControlOp =
  | { op: "stop"; reason: RunControlReason }
  | { op: "rerun"; reason: RunControlReason }
  | { op: "rerun-step"; reason: RunControlReason; stageIdx: number };

/** Dừng / chạy lại bước / chạy lại cả lượt; xong làm tươi mọi dữ liệu lượt chạy. Kết quả `rerun` có `id` lượt mới (nếu server trả). */
export function useRunControl(id: string, tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: RunControlOp): Promise<unknown> => {
      const query = { tenant_id: tenantId };
      const path = url(`/process-runs/${enc(id)}/${a.op}`);
      if (a.op === "rerun-step") {
        const body: RerunStepRequest = { reason: a.reason, stage_idx: a.stageIdx };
        return api<unknown>(path, { method: "POST", query, body });
      }
      const body: StopProcessRunRequest | RerunProcessRunRequest = { reason: a.reason };
      return api<unknown>(path, { method: "POST", query, body });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["process"] }),
  });
}
