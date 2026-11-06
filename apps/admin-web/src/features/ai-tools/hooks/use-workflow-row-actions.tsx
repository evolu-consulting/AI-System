// CR-121 F4 · D6: bật/tắt + xoá workflow Dify (409 "đang dùng" ⇒ hộp thoại nêu agent/lệnh nào đang dùng) ngay trên danh sách Công cụ AI.
// Dùng lại hook/API cũ của features/workflows (không viết lại): chỉ đọc chi tiết MỚI (version hiện tại) trước khi gọi.
import type { Workflow } from "@ai/contracts/workflows";
import { useQueryClient } from "@tanstack/react-query";
import { fetchWorkflow, WORKFLOW_KEYS } from "@/features/workflows/api";
import { useWorkflowActions } from "@/features/workflows/hooks/use-workflow-actions";
import { useWorkflowFail } from "@/features/workflows/hooks/use-workflow-fail";

export function useWorkflowRowActions() {
  const qc = useQueryClient();
  const fail = useWorkflowFail();
  const actions = useWorkflowActions();
  const fresh = (id: string): Promise<Workflow> =>
    qc.fetchQuery({
      queryKey: WORKFLOW_KEYS.detail(id),
      queryFn: () => fetchWorkflow(id),
      staleTime: 0,
    });
  const run = (fn: (w: Workflow) => void) => async (id: string) => {
    try {
      fn(await fresh(id));
    } catch (err) {
      fail(err);
    }
  };
  return {
    /** Từ hàng (chỉ có id): đọc bản mới rồi bật/tắt. */
    toggleById: run((w) => void actions.toggle(w)),
    removeById: run((w) => void actions.remove(w)),
    /** Từ ngăn chi tiết (đã có bản đầy đủ). */
    toggle: actions.toggle,
    remove: actions.remove,
    dialogs: actions.dialogs,
  };
}

export type WorkflowRowActions = ReturnType<typeof useWorkflowRowActions>;
