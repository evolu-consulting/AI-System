// ADM-FR-68 · FS6 · "Kiểm tra kết nối": POST /:key/check đồng bộ (Hub chờ Runtime tới `timeout_s`). Một lần chạy một lúc;
// bỏ bằng AbortController khi đóng drawer (unmount) hoặc quá 130 s phía client. 200 ⇒ làm tươi danh sách (cột Trạng thái).
import { useCallback, useEffect, useRef, useState } from "react";
import { checkSource, useInvalidateSources } from "../api";
import { isAbort, isTimeout, sourceErrorKey } from "../lib/errors";
import { type CheckSummary, summarizeCheck } from "../lib/source-view";

export const CHECK_CLIENT_TIMEOUT_MS = 130_000;
const TIMEOUT_KEY = "process.sources.apiError.TIMEOUT";

export type CheckState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "ok"; summary: CheckSummary; sha?: string }
  | { phase: "error"; key: string };

/** Khoá câu lỗi của kết quả kiểm tra thất bại (mạng/hết hạn ⇒ câu Runtime không phản hồi). */
export function checkErrorKey(err: unknown, timedOut: boolean): string {
  if (timedOut || isTimeout(err)) return TIMEOUT_KEY;
  return sourceErrorKey(err);
}

export function useSourceCheck(tenantId: string | undefined) {
  const [state, setState] = useState<CheckState>({ phase: "idle" });
  const ctrl = useRef<AbortController | null>(null);
  const invalidate = useInvalidateSources();

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(
    async (key: string, branch?: string) => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        c.abort();
      }, CHECK_CLIENT_TIMEOUT_MS);
      setState({ phase: "running" });
      try {
        const res = await checkSource(key, tenantId, c.signal);
        if (ctrl.current !== c) return;
        const summary = summarizeCheck(res, branch);
        setState({
          phase: "ok",
          summary,
          sha: res.pin.kind === "git_remote" ? res.pin.sha : undefined,
        });
        void invalidate();
      } catch (err) {
        if (ctrl.current !== c) return; // đã bị thay/huỷ (đóng drawer)
        if (isAbort(err) && !timedOut) return;
        setState({ phase: "error", key: checkErrorKey(err, timedOut) });
      } finally {
        clearTimeout(timer);
      }
    },
    [tenantId, invalidate],
  );
  const cancel = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    setState({ phase: "idle" });
  }, []);
  return { state, run, cancel };
}
