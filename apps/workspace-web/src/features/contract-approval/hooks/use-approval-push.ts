// CR-107 · eng-card-ui: thẻ duyệt nghe `/me/stream` (`process.updated` / `review_task.created` của đúng run) ⇒ tải lại thẻ.
// Mở một kết nối khi lượt engine cấp 1 có run; đóng khi rời trang / hết điều kiện. Run mới (Huỷ & mở lại) đổi `run_id` ⇒ lọc theo ref.
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { useEffect, useRef } from "react";
import { eventConcernsRun, shouldListen } from "../lib/advance-wait";
import { listenProcessEvents } from "../stream/process-stream";

export function useApprovalPush(
  approval: ContractApproval | undefined,
  onChange: () => void,
): void {
  const runId = useRef<string | null>(null);
  const change = useRef(onChange);
  runId.current = approval?.run_id ?? null;
  change.current = onChange;
  const listen = shouldListen(approval);
  useEffect(() => {
    if (!listen) return;
    const ac = new AbortController();
    void listenProcessEvents(
      ac.signal,
      (e) => {
        if (eventConcernsRun(e, runId.current)) change.current();
      },
      () => change.current(),
    );
    return () => ac.abort();
  }, [listen]);
}
