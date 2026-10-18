// HUB-FR-144 · HUB-BR-42 · PD-R12 · plan §4.8 · use case lớp 2: huỷ hẹn chưa bắn khi run huỷ/kết thúc ("all") hoặc quay
// lại bước (stage có `step ≥ toStep`, `stagesToCancelOnBack`). Chạy TRONG tx của người gọi, run ĐÃ khoá và stage đã ghi
// (thứ tự run → stage → timer, plan §6) ⇒ hẹn tới hạn bắn song song đọc lại thấy `cancelled_at` và bỏ.
import { stagesToCancelOnBack } from "../../domain/timers/timer.rules";
import type { TxRepos } from "../ports";

export type CancelTimersScope =
  | { kind: "all" }
  | { kind: "back"; stages: readonly { stageRunId: string; step: number }[]; toStep: number };

/** Trả số hẹn vừa huỷ (một câu UPDATE; quay lại mà không stage nào bị ảnh hưởng ⇒ 0 câu). */
export async function cancelTimers(
  r: Pick<TxRepos, "timers">,
  runId: string,
  scope: CancelTimersScope,
  now: Date,
): Promise<number> {
  if (scope.kind === "all") return r.timers.cancelForRun(runId, "all", now);
  const ids = stagesToCancelOnBack(scope.stages, scope.toStep);
  return ids.length === 0 ? 0 : r.timers.cancelForRun(runId, ids, now);
}
