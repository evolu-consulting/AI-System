// CHAT-AC-53 · mutation `POST /process-runs/:id/decide` (Cần người quyết) và `/cancel` (Huỷ lượt chạy).
// Thành công ⇒ invalidate view + danh sách run; component lo toast và lỗi `NOT_PROCESS_DECIDER`/`PROCESS_RUN_STATE`/`NO_OUTPUT`.
import type { DecisionOption } from "@ai/contracts/chat";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { processKeys } from "../../shared/keys";
import { postCancelRun, postDecide } from "../api";

function useRunInvalidate(runId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: processKeys.run(runId), refetchType: "active" });
    void qc.invalidateQueries({ queryKey: ["process", "runs"], refetchType: "active" });
  };
}

export function useDecide(runId: string) {
  const invalidate = useRunInvalidate(runId);
  return useMutation({
    mutationFn: (v: { option: DecisionOption; note?: string }) =>
      postDecide(runId, { option: v.option, note: v.note }),
    onSuccess: invalidate,
  });
}

export function useCancelRun(runId: string) {
  const invalidate = useRunInvalidate(runId);
  return useMutation({
    mutationFn: () => postCancelRun(runId),
    onSuccess: invalidate,
  });
}
