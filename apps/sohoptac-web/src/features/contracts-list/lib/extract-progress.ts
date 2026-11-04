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

/** Hộp mở khi đang tải lên hoặc HĐ còn `extracting`; đóng khi xong/lỗi (trạng thái khác). */
export const dialogOpen = (o: { uploading: boolean; status?: string | undefined }): boolean =>
  o.uploading || o.status === "extracting";
