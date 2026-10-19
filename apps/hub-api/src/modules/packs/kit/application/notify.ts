// N3-FR-01 · N3-FR-02 · N3-FR-03 · cổng thông báo của bộ khung gói. Dựng TRONG tx của `PackUow` (cùng commit/rollback với lệnh ghi
// nghiệp vụ). Một câu SQL cho cả lô, lô rỗng ⇒ 0 câu. Tenant lấy từ tx (không từ đầu vào); người nhận ngoài tenant bị bỏ qua.
// Lớp 2 — chỉ kiểu; `NotifyInput` khai lại (luật `ca-application-inward-only` cấm import contract), adapter ép trùng lúc biên dịch.

export type NotifyInput = {
  user_id: string;
  kind: string;
  title: string;
  body?: string;
  /** Đường dẫn trong app (bắt đầu `/`). */
  link?: string;
  /** Khóa idempotency theo (tenant, người nhận, gói): gửi lại cùng khóa ⇒ bỏ qua. Vắng ⇒ không idempotent. */
  dedup_key?: string;
};

export type Notifier = {
  /** Số thông báo MỚI được ghi (đã trừ trùng khóa và người nhận không cùng tenant). */
  enqueue(rows: readonly NotifyInput[]): Promise<number>;
};

/** Repo cổng thông báo trong tx mà gói nhận (gói ghép vào repo riêng khi cần). */
export type NotifyTxRepos = { notify: Notifier };
