// ADM-FR-67 · HUB-FR-143 · P-d1 T11b (plan-frontend §2 "Trang Run (admin)", FD6/FD7): nhãn trạng thái một giai đoạn của lượt chạy —
// "Chờ tới 14/12/2026 09:00 (Asia/Ho_Chi_Minh)", "Đang thử lại (2/3) · 10:42", "Bỏ qua", còn lại nhãn trạng thái cũ. Thuần.
import type { ProcessRunStatus, StageView } from "@ai/contracts/chat";
import { STAGE_RETRY_MAX } from "../domain/limits";
import { describeStageWait } from "../domain/stage-wait";
import { formatClock, formatWaitDateTime, type WaitLang } from "../domain/wait-format";

export type Translate = (key: string, params?: Record<string, unknown>) => string;
export type StageLabel = { text: string; tone: "info" | "warn" | "none" };

const statusKey = (s: StageView["status"]): string =>
  s === "pending" || s === "queued" ? `process.common.stage.${s}` : `process.common.status.${s}`;

/**
 * Huy hiệu trạng thái run (mockup 03 D1): đang thử lại (retry) là "Đang chạy"; chỉ hẹn `wait_until` mới là
 * "Đang chờ hẹn". Run `waiting_timer` mà không stage nào có `wait` nhưng có stage đang thử lại ⇒ `running`.
 */
export function runBadgeStatus(
  status: ProcessRunStatus,
  stages: readonly Pick<StageView, "status" | "retry_count" | "next_retry_at" | "wait">[],
): ProcessRunStatus {
  if (status !== "waiting_timer" || stages.some((s) => s.wait)) return status;
  const retrying = stages.some(
    (s) => s.next_retry_at || ((s.retry_count ?? 0) > 0 && s.status === "waiting_timer"),
  );
  return retrying ? "running" : status;
}

/** Cùng luật `runBadgeStatus` nhưng cho danh sách (`ProcessRunSummary`, không có stages): chỉ có `retry_at` ⇒ `running`. */
export function runSummaryBadgeStatus(r: {
  status: ProcessRunStatus;
  wait_until?: string | null;
  retry_at?: string | null;
}): ProcessRunStatus {
  return r.status === "waiting_timer" && !r.wait_until && r.retry_at ? "running" : r.status;
}

/** `viewerTz`: múi giờ máy người xem (giờ thử lại kế tiếp); `lang`: định dạng ngày. */
export function stageLabel(
  s: Pick<StageView, "status" | "retry_count" | "next_retry_at" | "wait">,
  t: Translate,
  lang: WaitLang,
  viewerTz: string,
): StageLabel {
  const info = describeStageWait({
    status: s.status,
    retryCount: s.retry_count,
    nextRetryAt: s.next_retry_at,
    wait: s.wait ? { dueAt: s.wait.due_at, timeZone: s.wait.timezone } : undefined,
  });
  switch (info.kind) {
    case "skipped":
      return { text: t("process.common.stage.skipped"), tone: "none" };
    case "waiting_date":
      return {
        text: t("process.common.stageLabel.waitUntilAt", {
          date: formatWaitDateTime(info.dueAt, info.timeZone, lang),
          tz: info.timeZone,
        }),
        tone: "info",
      };
    case "retrying": {
      const n = { n: info.n, max: STAGE_RETRY_MAX };
      const time = info.nextAt ? formatClock(info.nextAt, viewerTz, lang) : "";
      return time
        ? { text: t("process.common.stageLabel.retryingAt", { ...n, time }), tone: "warn" }
        : { text: t("process.common.stageLabel.retrying", n), tone: "warn" };
    }
    case "waiting":
      return { text: t("process.common.status.waiting_timer"), tone: "info" };
    default:
      return { text: t(statusKey(s.status)), tone: "none" };
  }
}
