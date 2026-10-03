// ADM-FR-52 · M4-AC08 · M4-R13 · "Khôi phục bản trước": gọi mutation, toast thành công/lỗi; 403 → nạp lại phiên (plan-frontend §3.4, §8).
import type { AuditItem } from "@ai/contracts";
import { useCallback } from "react";
import { notifyError, notifyInfo, notifySuccess } from "@/components/shared/toast";
import { session } from "@/lib/auth/session";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useAuditRestore } from "../api";
import { displayName, restoreErrorSpec } from "../lib/restore";

async function reloadSession(): Promise<void> {
  try {
    await session.reload();
  } catch {
    // giữ phiên cũ; lần tải sau sẽ đúng
  }
}

/** Hàm `restore()` cho `ConfirmDialog.onConfirm`: lỗi nghiệp vụ → đóng hộp thoại; lỗi khác ném lại để giữ mở thử lại. */
export function useRestore(item: AuditItem) {
  const tr = useTr();
  const m = useAuditRestore();
  const { mutateAsync } = m;
  const restore = useCallback(async () => {
    try {
      const res = await mutateAsync(item.id);
      const name = displayName(item.entity, item.entity_name);
      notifySuccess(tr("audit.restore.done", { name, n: res.version }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") throw err;
      const business = restoreErrorSpec(err, item, tr);
      if (business) {
        // 409/400 nghiệp vụ: thử lại không đổi được kết quả → toast (role status), đóng hộp thoại.
        notifyInfo(tr(business.key, business.params));
        return;
      }
      if (err instanceof ApiError && err.status === 403) void reloadSession();
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
      throw err;
    }
  }, [item, mutateAsync, tr]);
  return { restore, pending: m.isPending };
}
