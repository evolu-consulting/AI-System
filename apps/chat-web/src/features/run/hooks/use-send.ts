// UC-02, UC-04, UC-05 · gửi tin (ô chính → flow mới; trong khung/chip ask → cùng flow), Chạy lại, Dừng, Thử lại nối.
// Lỗi trước stream: `CMD_*` hiện trong composer (`SendErrorNotice`, không toast); 409 `FLOW_BUSY` → toast `toast.flowBusy`, khác → `toast.sendFailed`; composer giữ chữ khi `ok: false`.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { isComposerError } from "~/features/composer/lib/send-error";
import type { RunState } from "../lib/reducer";
import type { SendOutcome } from "../run-driver";
import { runDriver } from "../runtime";

export type FlowRef = { id: string; last_active_at: string };

export type RunActions = {
  /** Ô chính: không `flow_id` → Hub tạo flow mới. */
  sendMain(convId: string, content: string, attachmentIds?: string[]): Promise<SendOutcome>;
  /** Khung flow / chip ask: cùng flow; flow nghỉ (`isFlowIdle`) → pha `cold` tới `run.started`. */
  sendInFlow(
    convId: string,
    flow: FlowRef,
    content: string,
    attachmentIds?: string[],
  ): Promise<SendOutcome>;
  /** "Chạy lại" / "Thử lại" của câu trả lời lỗi. */
  rerun(run: RunState, flowLastActiveAt?: string): Promise<SendOutcome>;
  /** ■ / Esc. */
  cancel(key: string): Promise<void>;
  /** "Thử lại" của banner mất kết nối (`phase = lost`). */
  reconnect(key: string): void;
  /** View đã thấy `answerId` trong query → bỏ run khỏi store. */
  dismiss(key: string): void;
};

export function useSend(): RunActions {
  const { t } = useTranslation();
  return useMemo(() => {
    const report = (o: SendOutcome): SendOutcome => {
      if (!o.ok && !isComposerError(o.error))
        toast.error(t(o.error.code === "FLOW_BUSY" ? "toast.flowBusy" : "toast.sendFailed"));
      return o;
    };
    return {
      sendMain: (convId, content, attachmentIds) =>
        runDriver
          .send({ convId, origin: "main", request: { content, attachmentIds } })
          .then(report),
      sendInFlow: (convId, flow, content, attachmentIds) =>
        runDriver
          .send({
            convId,
            origin: "flow",
            request: { content, flowId: flow.id, attachmentIds },
            flowLastActiveAt: flow.last_active_at,
          })
          .then(report),
      rerun: (run, flowLastActiveAt) => runDriver.retry(run, flowLastActiveAt).then(report),
      cancel: (key) => runDriver.cancel(key),
      reconnect: (key) => runDriver.reconnect(key),
      dismiss: (key) => runDriver.drop(key),
    };
  }, [t]);
}
