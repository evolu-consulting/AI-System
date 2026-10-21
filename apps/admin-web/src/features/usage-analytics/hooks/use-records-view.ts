// ADM-FR-42 · usage-analytics · trạng thái bảng bản ghi: chồng con trỏ keyset (Trước/Sau; đổi bộ lọc ⇒ về trang đầu, không
// cần effect), xuất CSV, run đang xem chi tiết + truy vấn của nó, quota tháng (báo cáo M4).
import { useState } from "react";
import { useUsage } from "@/features/usage/api";
import { currentMonth, monthRange } from "@/features/usage/lib/months";
import { type AnalyticsParams, useRecords, useRecordsCsv, useRun } from "../api";

export function useRecordsView(params: AnalyticsParams, enabled: boolean) {
  const k = JSON.stringify(params);
  const [st, setSt] = useState<{ k: string; stack: string[] }>({ k, stack: [] });
  const stack = st.k === k ? st.stack : [];
  const q = useRecords(params, stack[stack.length - 1], enabled);
  const csv = useRecordsCsv();
  const [runId, setRunId] = useState<string | null>(null);
  const run = useRun(runId);
  const next = q.data?.next_cursor ?? null;
  return {
    q,
    csv,
    hasPrev: stack.length > 0,
    hasNext: next !== null,
    prev: () => setSt({ k, stack: stack.slice(0, -1) }),
    next: () => {
      if (next) setSt({ k, stack: [...stack, next] });
    },
    runId,
    run,
    openRun: setRunId,
    closeRun: () => setRunId(null),
  };
}

/** Quota tháng hiện tại (VN) của tenant đang lọc, hoặc bảng theo tenant khi platform không chọn tenant. */
export function useQuotaReport(tenantId: string | undefined, enabled: boolean) {
  return useUsage({ tenantId, ...monthRange(currentMonth(new Date())) }, enabled);
}
