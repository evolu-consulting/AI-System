// HUB-FR-106 · D10 · D11 · AC-H32 · HUB-FR-143 · T7s · use case lớp 2: stage `running` mà `hub.runs` đã kết thúc quá hạn
// ⇒ `needs_decision{interrupted}`. Chỉ biết port (không `Tx`): `open` chạy MỘT tx ở adapter (khoá run, kiểm lại stage còn
// `running`, đặt `needs_decision` + `decision` JSON, mở task, xếp thread, báo notifier); sự kiện publish + đăng thread
// SAU COMMIT. `E` = kiểu sự kiện người dùng của adapter — lớp 2 chỉ chuyển tiếp.
import type { DecisionReason } from "../../domain/types";

export type InterruptedPorts<E> = {
  /** Một tx scope system; `null` ⇒ bỏ (run không còn hoạt động / stage không còn `running` sau khoá). */
  open(
    p: { runId: string; stageRunId: string; reason: DecisionReason },
    now: Date,
  ): Promise<E | null>;
  publish(events: E): Promise<void>;
  postThread(runId: string): Promise<unknown>;
};

/** D11 · `true` nếu đã chuyển sang `needs_decision` (đã publish + đăng thread); `false` nếu bỏ. */
export async function sweepInterrupted<E>(
  ports: InterruptedPorts<E>,
  p: { runId: string; stageRunId: string },
  now: Date,
): Promise<boolean> {
  const out = await ports.open({ ...p, reason: "interrupted" }, now);
  if (out === null) return false;
  await ports.publish(out);
  await ports.postThread(p.runId).catch(() => {});
  return true;
}
