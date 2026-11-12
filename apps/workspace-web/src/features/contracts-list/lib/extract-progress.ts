// ux-excel E5: tiến độ giả lập cho hộp "Upload hợp đồng" (API chưa báo bước đọc) — chip sáng lần lượt theo thời gian khi còn `extracting`.
export const EXTRACT_STEPS = ["extract", "items", "summary"] as const;
export type ExtractStep = (typeof EXTRACT_STEPS)[number];

export const STEP_MS = 6000;

/** Chỉ số chip đang chạy sau `elapsedMs`; dừng ở chip cuối cho tới khi máy chủ xong. */
export const activeStep = (elapsedMs: number, stepMs = STEP_MS): number =>
  Math.min(EXTRACT_STEPS.length - 1, Math.max(0, Math.floor(elapsedMs / stepMs)));

export type ChipState = "done" | "active" | "todo";

export const chipStates = (active: number): ChipState[] =>
  EXTRACT_STEPS.map((_, i) => (i < active ? "done" : i === active ? "active" : "todo"));

/** Hộp mở khi đang tải lên hoặc AI còn đọc (`extract_state = reading`, không phải trạng thái HĐ); đóng khi xong/lỗi. */
export const dialogOpen = (o: { uploading: boolean; extract?: string | undefined }): boolean =>
  o.uploading || o.extract === "reading";
