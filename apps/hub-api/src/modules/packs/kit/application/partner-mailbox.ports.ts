// CR-124 · q3 · FLOW4-FR-07/11 · cổng giữa bộ chuyển hộp thư liên công ty (hub `partners/`) và gói Hợp đồng. Bộ chuyển KHÔNG đọc/ghi bảng gói:
// bên nhận ⇒ gói mở tx TRONG scope tenant nhận (spec §7.2) tạo HĐ nhận + sự kiện `contract.received`; bên gửi ⇒ gói đóng lần gửi + bắn tín hiệu
// `partner.*` cho node chờ. Lớp 2 — chỉ kiểu; không I/O.

/** Một câu trả lời đã chốt ở hộp thư, chờ báo về tenant GỬI. `ref` = `from_ref` (id HĐ phía gửi). */
export type PartnerReplyRow = {
  mailboxId: string;
  tenantId: string;
  ref: string | null;
  outcome: "confirmed" | "returned" | "declined";
  reason: string | null;
  source: string;
  round: number;
};

export type PartnerMailboxPort = {
  /** Tenant NHẬN `tenantId`: lấy tối đa `limit` lần gửi kênh nền tảng, tạo HĐ nhận + `contract.received` CÙNG tx. Trả số HĐ nhận mới. */
  receive(tenantId: string, limit: number): Promise<number>;
  /** Báo kết quả về tenant GỬI. Ném ⇒ bộ chuyển KHÔNG chốt `reply_emitted_at` (thử lại lượt sau); idempotent theo `mailboxId`. */
  onReplies(rows: readonly PartnerReplyRow[]): Promise<void>;
};

export type PartnerMailboxPortRegistry = {
  set(p: PartnerMailboxPort | undefined): void;
  get(): PartnerMailboxPort | undefined;
};
