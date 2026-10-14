// ADM-FR-68 · FS6 · "Kiểm tra kết nối": POST /:key/check đồng bộ (Hub chờ Runtime tới `timeout_s`). Một lần chạy một lúc;
// bỏ bằng AbortController khi đóng drawer (unmount) hoặc quá 130 s phía client. 200 ⇒ làm tươi danh sách (cột Trạng thái).
import { useCallback, useEffect, useRef, useState } from "react";
import { checkSource, useInvalidateSources } from "../api";
import { hasCode, isAbort, isTimeout, sourceErrorKey } from "../lib/errors";
import { type CheckSummary, summarizeCheck } from "../lib/source-view";

export const CHECK_CLIENT_TIMEOUT_MS = 130_000;
const TIMEOUT_KEY = "process.sources.apiError.TIMEOUT";

/** git có khoá / git không khoá / không phải git — để map `SOURCE_UNRESOLVABLE` cho đúng (PC2-R10). */
export type GitCred = "has" | "none" | null;

export type CheckState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "ok"; summary: CheckSummary; sha?: string }
  | { phase: "error"; key: string; hintKey?: string };

/** Khoá câu lỗi + gợi ý của kết quả kiểm tra thất bại. SOURCE_UNRESOLVABLE: git có khoá ⇒ khoá sai/hết hạn; git chưa có khoá ⇒ gợi ý gán khoá. */
export function checkError(
  err: unknown,
  timedOut: boolean,
  git: GitCred,
): { key: string; hintKey?: string } {
  if (timedOut || isTimeout(err)) return { key: TIMEOUT_KEY };
  if (hasCode(err, "SOURCE_UNRESOLVABLE") && git !== null) {
    return git === "has"
      ? { key: "process.sources.check.unresolvable.private" }
      : { key: sourceErrorKey(err), hintKey: "process.sources.check.privateNoKey" };
  }
  return { key: sourceErrorKey(err) };
}

export function useSourceCheck(tenantId: string | undefined) {
  const [state, setState] = useState<CheckState>({ phase: "idle" });
  const ctrl = useRef<AbortController | null>(null);
  const invalidate = useInvalidateSources();

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(
    async (key: string, branch?: string, git: GitCred = null) => {
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
        setState({ phase: "error", ...checkError(err, timedOut, git) });
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
