// ADM-FR-73 · AC-A15 · P-d2 (plan-frontend-d2 §12): tab "Tool quy trình" — danh sách + bật (PUT, không hỏi) / tắt (hỏi xác nhận, DELETE).
// Công tắc không optimistic: chờ server rồi làm mới; 404 ⇒ "không còn trong catalog" + tải lại; lỗi khác ⇒ toast, công tắc về cũ.
import type { TenantWorkflowTool } from "@ai/contracts";
import { useState } from "react";
import { notifyError, notifyInfo, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useSetTenantTool, useTenantWorkflowTools } from "../api";

/** Lọc client theo tên / ký hiệu (không phân biệt hoa thường); rỗng ⇒ giữ nguyên. */
export function filterTools(items: readonly TenantWorkflowTool[], q: string): TenantWorkflowTool[] {
  const s = q.trim().toLowerCase();
  return s === ""
    ? [...items]
    : items.filter((x) => x.name.toLowerCase().includes(s) || x.key.toLowerCase().includes(s));
}

export function useTenantTools(tenant: { id: string; name: string }) {
  const t = useTr();
  const list = useTenantWorkflowTools(tenant.id, true);
  const set = useSetTenantTool(tenant.id);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [off, setOff] = useState<TenantWorkflowTool | null>(null);

  const run = async (row: TenantWorkflowTool, on: boolean) => {
    setPendingId(row.workflow_id);
    try {
      await set.mutateAsync({ workflowId: row.workflow_id, on });
      const key = on ? "tenants.tools.toast.on" : "tenants.tools.toast.off";
      notifySuccess(t(key, { name: row.name, tenant: tenant.name }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) notifyInfo(t("tenants.tools.toast.gone"));
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
    /** 403 ⇒ trang "không có quyền"; lỗi khác ⇒ `loadError` (DataTable hiện ErrorState + Thử lại). */
    forbidden: apiErr?.status === 403,
    loadError: e
      ? { message: e.message, code: apiErr ? String(apiErr.code) : "NETWORK_ERROR" }
      : null,
    pendingId,
    off,
    /** Bật ⇒ làm ngay; tắt ⇒ mở hộp xác nhận. */
    toggle: (row: TenantWorkflowTool, want: boolean) => (want ? void run(row, true) : setOff(row)),
    cancelOff: () => setOff(null),
    confirmOff: async () => {
      const row = off;
      setOff(null);
      if (row) await run(row, false);
    },
  };
}
