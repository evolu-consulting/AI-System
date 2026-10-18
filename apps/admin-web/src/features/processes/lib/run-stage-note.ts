// ADM-FR-67 · HUB-FR-143 · P-d2 (D2-45; UAT P-d1 B5): ghi chú dưới ô "Giai đoạn" của danh sách lượt chạy — "Chờ tới <ngày giờ>" (hẹn
// `wait_until`) hoặc "Thử lại lúc <giờ>" (hẹn `retry`). Hai hẹn loại trừ nhau (A4 G5); không có ⇒ null. Thuần.
import { formatClock, formatWaitDateTime, type WaitLang } from "../domain/wait-format";

export type RunStageNote = { key: string; params: { date: string } | { time: string } };

/** Danh sách run không có múi giờ công ty của hẹn ⇒ định dạng theo múi giờ máy người xem (`viewerTz`). */
export function runStageNote(
  r: { wait_until?: string | null; retry_at?: string | null },
  viewerTz: string,
  lang: WaitLang,
): RunStageNote | null {
  if (r.wait_until)
    return {
      key: "process.admin.editor.runs.waitUntil",
      params: { date: formatWaitDateTime(r.wait_until, viewerTz, lang) },
    };
  if (r.retry_at)
    return {
      key: "process.admin.editor.runs.retryAt",
      params: { time: formatClock(r.retry_at, viewerTz, lang) },
    };
  return null;
}
