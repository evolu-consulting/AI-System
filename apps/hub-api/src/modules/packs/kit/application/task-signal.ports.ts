// CR-127 · E10 · spec §5.9 · #54 · #72 · cổng gói → engine cho việc nhóm gắn bản ghi của gói (Xác nhận mốc). Gói CHỈ ghi tín hiệu
// (`hub.task_signal`) trong tx của chính nó — KHÔNG khoá `review_tasks` (tránh khoá ngược HĐ→mốc→task vs run→task). Engine xử lý tín
// hiệu ở tx riêng (vòng `task-signal`). `holder` đọc người đang giữ việc (không khoá) cho luật «đang xử lý» (BR-40, X5).
export type FlowTaskKind = "milestone";
export type FlowTaskSubject = { kind: FlowTaskKind; subjectRef: string };
export type FlowTaskSignalResult = "done" | "cancelled";
export type FlowTaskHolder = {
  taskId: string;
  claimedBy: string | null;
  assigneeIds: readonly string[];
};

/** `TX` = handle tx của gói (đã đặt `app.tenant_id`); kit không phụ thuộc kiểu drizzle cụ thể. */
export type FlowTaskSignal<TX = unknown> = {
  /** Ghi tín hiệu đóng việc (idempotent: tín hiệu chưa xử lý trùng ⇒ không thêm hàng). Trả id tín hiệu mới hoặc null nếu đã có. */
  complete(tx: TX, s: FlowTaskSubject, result: FlowTaskSignalResult): Promise<string | null>;
  /** Việc MỞ của bản ghi (rỗng ⇒ không có việc). */
  holder(tx: TX, s: FlowTaskSubject): Promise<FlowTaskHolder[]>;
};
