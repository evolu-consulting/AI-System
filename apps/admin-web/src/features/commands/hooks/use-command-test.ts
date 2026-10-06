// ADM-FR-23 · X1 F4 · trạng thái "Chạy thử": gọi, huỷ ("Dừng" = abort fetch), 409 `SIDE_EFFECT_CONFIRM_REQUIRED` → hộp xác nhận
// rồi gửi lại cùng body kèm `confirm_side_effect:true`. Không TanStack mutation: cần huỷ được và không cache kết quả.
import type { CommandTestRequest, CommandTestResponse } from "@ai/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/http";
import { runCommandTest } from "../api";

export type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: CommandTestResponse }
  | { status: "error"; error: unknown };

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

type Pending = { current: CommandTestRequest | null };

/** Hộp xác nhận side effect: "Vẫn chạy" gửi lại body đang chờ kèm `confirm_side_effect:true`; Huỷ bỏ body. */
function useConfirmGate(
  pending: Pending,
  setOpen: (v: boolean) => void,
  run: (b: CommandTestRequest) => Promise<void>,
) {
  const confirm = useCallback(() => {
    setOpen(false);
    const body = pending.current;
    pending.current = null;
    if (body) void run({ ...body, confirm_side_effect: true });
  }, [pending, setOpen, run]);
  const cancel = useCallback(() => {
    setOpen(false);
    pending.current = null;
  }, [pending, setOpen]);
  return { confirm, cancel };
}

export function useCommandTest() {
  const ctrl = useRef<AbortController | null>(null);
  const pending = useRef<CommandTestRequest | null>(null);
  const [state, setState] = useState<TestState>({ status: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** `command` của lần chạy xong gần nhất (gợi ý "Bạn chưa chạy thử bản này"). */
  const [tested, setTested] = useState<string | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async (body: CommandTestRequest) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState({ status: "running" });
    try {
      const result = await runCommandTest(body, c.signal);
      if (c.signal.aborted) return;
      setState({ status: "done", result });
      setTested(JSON.stringify(body.command));
    } catch (err) {
      if (c.signal.aborted || isAbort(err)) return;
      if (err instanceof ApiError && (err.code as string) === "SIDE_EFFECT_CONFIRM_REQUIRED") {
        pending.current = body;
        setState({ status: "idle" });
        setConfirmOpen(true);
        return;
      }
      setState({ status: "error", error: err });
    } finally {
      if (ctrl.current === c) ctrl.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    setState({ status: "idle" });
  }, []);

  const gate = useConfirmGate(pending, setConfirmOpen, run);
  return { state, run, stop, confirmOpen, ...gate, tested };
}
