// CR-103 · R4 fnr-showcase: cầu nối cho trang showcase — tìm def mẫu theo key, bắt đầu run, theo dõi run (làm tươi định kỳ).
import { FLOW_SHOWCASE_KEY, type ProcessInputValue } from "@ai/contracts/hub-admin";
import { useEffect, useState } from "react";
import { runDef, useInvalidateDefs, useProcessDef, useRun } from "../api";
import { useLibraryDefs } from "../library-api";

const POLL_MS = 1_500;

/** Def mẫu: duyệt các trang "Mẫu · chạy thử" (`kind=sample`, CR-105: showcase là def không khe/không của gói) tới khi gặp `FLOW_SHOWCASE_KEY`; hết trang mà không có ⇒ `missing`. */
export function useShowcaseDef(tenantId: string | undefined, enabled: boolean) {
  const list = useLibraryDefs("sample", enabled, tenantId);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const row = items.find((r) => r.key === FLOW_SHOWCASE_KEY);
  useEffect(() => {
    if (!row && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [row, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const def = useProcessDef(row?.id, tenantId);
  if (list.isError) return { state: "error" as const, retry: () => void list.refetch() };
  if (def.isError) return { state: "error" as const, retry: () => void def.refetch() };
  if (def.data) return { state: "ok" as const, def: def.data };
  if (list.isPending || hasNextPage || isFetchingNextPage || (row && def.isPending))
    return { state: "loading" as const };
  return { state: "missing" as const };
}

/** "Chạy thử": giữ `runId` vừa tạo; lỗi ném lại cho trang hiện câu lỗi. */
export function useShowcaseStart(defId: string | undefined, tenantId: string | undefined) {
  const invalidate = useInvalidateDefs();
  const [runId, setRunId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const start = async (inputs: ProcessInputValue[]) => {
    if (!defId) return;
    setPending(true);
    try {
      const r = await runDef(defId, "", tenantId, inputs, true);
      setRunId(r.id);
      void invalidate();
    } finally {
      setPending(false);
    }
  };
  return { runId, start, pending, reset: () => setRunId(null) };
}

/** Run đang xem; làm tươi mỗi 1,5 s tới khi kết thúc (admin chưa có stream). */
export const useShowcaseRun = (runId: string, tenantId: string | undefined) =>
  useRun(runId, tenantId, POLL_MS);
