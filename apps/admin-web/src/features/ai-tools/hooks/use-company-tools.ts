// CR-121 R6 · c16 (chuyển từ `features/tenants/hooks/use-tenant-tools.ts`, D6): "Công ty dùng" của một công cụ — bật (PUT, không hỏi)
// / tắt (hỏi xác nhận, DELETE). Công tắc không optimistic: chờ server rồi làm mới; 404 ⇒ "không còn trong danh mục"; lỗi khác ⇒ toast.
import type { WorkflowCompany } from "@ai/contracts/workflow-tools";
import { useState } from "react";
import { notifyError, notifyInfo, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useSetCompanyTool, useWorkflowCompanies } from "../api";

export function useCompanyTools(tool: { id: string; name: string }) {
  const t = useTr();
  const list = useWorkflowCompanies(tool.id);
  const set = useSetCompanyTool(tool.id);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [off, setOff] = useState<WorkflowCompany | null>(null);

  const run = async (row: WorkflowCompany, on: boolean) => {
    setPendingId(row.tenant_id);
    try {
      await set.mutateAsync({ tenantId: row.tenant_id, on });
      const key = on ? "aiTools.toast.on" : "aiTools.toast.off";
      notifySuccess(t(key, { tool: tool.name, company: row.name }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) notifyInfo(t("aiTools.toast.gone"));
      else {
        const spec = describeError(err);
        notifyError(t(spec.key, spec.params));
      }
    } finally {
      setPendingId(null);
    }
  };
  const e = list.error;
  const apiErr = e instanceof ApiError ? e : null;
  return {
    list,
    loadError: e
      ? { message: e.message, code: apiErr ? String(apiErr.code) : "NETWORK_ERROR" }
      : null,
    pendingId,
    off,
    /** Bật ⇒ làm ngay; tắt ⇒ mở hộp xác nhận. */
    toggle: (row: WorkflowCompany, want: boolean) => (want ? void run(row, true) : setOff(row)),
    cancelOff: () => setOff(null),
    confirmOff: async () => {
      const row = off;
      setOff(null);
      if (row) await run(row, false);
    },
  };
}
