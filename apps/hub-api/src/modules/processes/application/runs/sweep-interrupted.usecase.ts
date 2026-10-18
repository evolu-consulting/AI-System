// HUB-FR-106 · D10 · D11 · AC-H32 · HUB-FR-143 · T7s/T7 · use case lớp 2: stage `running` mà `hub.runs` đã kết thúc quá
// hạn ⇒ `interrupted` (lỗi tạm, PD-R01): còn lượt ⇒ hẹn `retry` (stage `waiting_timer`); hết lượt / đã gửi side_effect ⇒
// `needs_decision{retry_exhausted | interrupted}` (plan §4.4). Chỉ biết port (không `Tx`): `open` chạy MỘT tx ở adapter
// (khoá run → đọc lại stage còn `running` → gọi `decide` với repo của tx → ghi quyết định); sự kiện publish + đăng thread
// SAU COMMIT. `E` = kiểu sự kiện người dùng của adapter — lớp 2 chỉ chuyển tiếp.
import type { DecisionReason } from "../../domain/types";
import { type FailureRepos, handleJobFailure } from "./handle-job-failure.usecase";

/** Trong tx đã khoá run: `null` ⇒ đã hẹn thử lại (không mở quyết định); khác ⇒ lý do `needs_decision`. */
export type InterruptDecider = (r: FailureRepos) => Promise<DecisionReason | null>;

export type InterruptedPorts<E> = {
  /** Một tx scope system; `null` ⇒ bỏ (run không còn hoạt động / stage không còn `running` sau khoá). */
  open(
    p: { runId: string; stageRunId: string },
    now: Date,
    decide: InterruptDecider,
  ): Promise<E | null>;
  publish(events: E): Promise<void>;
  postThread(runId: string): Promise<unknown>;
};

/** D11 · `true` nếu đã xử lý (hẹn thử lại hoặc `needs_decision`, đã publish + đăng thread); `false` nếu bỏ. */
export async function sweepInterrupted<E>(
  ports: InterruptedPorts<E>,
  p: { runId: string; stageRunId: string },
  now: Date,
): Promise<boolean> {
  const decide: InterruptDecider = async (r) => {
    const dec = await handleJobFailure(
      r,
      { ...p, code: null, reason: null, interrupted: true },
      now,
    );
    return dec.kind === "decide" ? dec.reason : null;
  };
  const out = await ports.open(p, now, decide);
  if (out === null) return false;
  await ports.publish(out);
  await ports.postThread(p.runId).catch(() => {});
  return true;
}
