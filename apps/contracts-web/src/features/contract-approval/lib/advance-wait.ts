// CR-107 · eng-card-ui: chờ engine chuyển bước = ĐẨY (`/me/stream`) là chính; tải lại lưới an toàn chỉ khi đang chuyển bước và
// KHÔNG có `attention`, giãn dần 2·4·8·16·30 s (trần 30 s), tối đa 10 lần. Thuần để test không cần đồng hồ.
import type { ContractApproval } from "@ai/contracts";
import type { MeStreamProcessEvent } from "@ai/contracts/chat";

export const ADVANCE_FIRST_MS = 2000;
export const ADVANCE_CAP_MS = 30_000;
export const ADVANCE_MAX_TRIES = 10;

/** Độ trễ trước lần tải lại thứ `tries` (0-based); hết lượt ⇒ `false` (dừng hẳn, không poll vô hạn). */
export const advanceDelay = (tries: number): number | false =>
  tries >= ADVANCE_MAX_TRIES ? false : Math.min(ADVANCE_FIRST_MS * 2 ** tries, ADVANCE_CAP_MS);

/** Sự kiện quy trình có liên quan run của thẻ này? (`process.updated` / `review_task.created` mang `process_run_id`.) */
export function eventConcernsRun(
  e: MeStreamProcessEvent,
  runId: string | null | undefined,
): boolean {
  if (!runId) return false;
  return (
    (e.event === "process.updated" || e.event === "review_task.created") &&
    e.data.process_run_id === runId
  );
}

/** Lắng nghe push khi lượt engine ở cấp 1 và có run (kể cả đang `attention`: Thử lại ⇒ kết quả tới qua push). */
export const shouldListen = (a: ContractApproval | undefined): boolean =>
  a?.mode === "engine" && a.step === "level1" && !!a.run_id;
