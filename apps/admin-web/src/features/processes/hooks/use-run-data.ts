// ADM-FR-67 · CR-056 · P-a F5: cầu nối từ component sang `api.ts` cho trang lượt chạy (component không được import api — depcruise).
import type { ProcessRunUsage } from "@ai/contracts/chat";
import { useState } from "react";
import { ApiError } from "@/lib/http";
import { runDef, useInvalidateDefs, useRunUsage } from "../api";

export { useRunAction, useRunOutput, useTenantRuns } from "../api";

export type UsageView =
  | { state: "loading" }
  | { state: "notFound" | "error"; refetch: () => void }
  | { state: "ok"; data: ProcessRunUsage };

/** Token của một lượt chạy rút gọn thành 4 trạng thái cho `UsageTab`. */
export function useUsageView(runId: string, tenantId: string | undefined): UsageView {
  const q = useRunUsage(runId, tenantId);
  if (q.isPending) return { state: "loading" };
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return { state: notFound ? "notFound" : "error", refetch: () => void q.refetch() };
  }
  return { state: "ok", data: q.data };
}

/** Chạy một quy trình từ danh sách; xong làm tươi danh sách (cột "Lượt đang chạy"). */
export function useStartRun(tenantId: string | undefined) {
  const invalidate = useInvalidateDefs();
  const [pending, setPending] = useState(false);
  const start = async (id: string, input: string) => {
    setPending(true);
    try {
      await runDef(id, input, tenantId);
      void invalidate();
    } finally {
      setPending(false);
    }
  };
  return { start, pending };
}
