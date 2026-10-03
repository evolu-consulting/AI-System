// UC-08, CHAT-AC-06 · đọc run từ store theo flow/hội thoại; mở flow có `active_run_id` mà tab này chưa theo dõi → gắn lại (E13 từ 0).
import { useEffect } from "react";
import type { RunOrigin, RunState } from "../lib/reducer";
import { selectActiveRun, selectFlowRun, useRuns } from "../run-store";
import { runDriver } from "../runtime";

export type RunTarget = {
  convId: string;
  flowId: string;
  /** `Flow.active_run_id` từ E10. */
  activeRunId: string | null;
  /** Khối flow ở luồng chính → `main`; khung flow → `flow` (quyết định "Chạy lại" có giữ flow không). */
  origin: RunOrigin;
};

/** Run mới nhất của flow (đang chạy hoặc vừa kết thúc, chưa được view `drop`). */
export function useRunStream(target: RunTarget | null): RunState | undefined {
  const flowId = target?.flowId;
  const run = useRuns((runs) => (flowId ? selectFlowRun(runs, flowId) : undefined));
  const convId = target?.convId;
  const activeRunId = target?.activeRunId;
  const origin = target?.origin;
  useEffect(() => {
    if (!convId || !flowId || !activeRunId || !origin) return;
    runDriver.attach({ convId, flowId, runId: activeRunId, origin });
  }, [convId, flowId, activeRunId, origin]);
  return run;
}

/** Run đang chạy của hội thoại (khoá nút Gửi của composer còn lại, UC-02). */
export function useActiveRun(convId: string | undefined): RunState | undefined {
  return useRuns((runs) => (convId ? selectActiveRun(runs, convId) : undefined));
}

/** Run theo khoá trả về từ `send` (trang chào: trước khi biết `flowId`). */
export function useRunByKey(key: string | null | undefined): RunState | undefined {
  return useRuns((runs) => (key ? runs.find((r) => r.key === key) : undefined));
}
