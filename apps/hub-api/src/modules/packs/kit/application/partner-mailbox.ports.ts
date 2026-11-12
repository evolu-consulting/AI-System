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
  /**
   * CR-124 · q5 · PDF của HĐ gửi (`fileRef` = tham chiếu tệp ghi ở lần gửi) trong tenant GỬI `tenantId` — cho thư/trang xem của bên nhận chưa dùng
   * nền tảng. Chỉ trả khi tệp thuộc đúng tenant đó, là PDF thật (mime + chữ ký `%PDF-`) và ≤ 25 MB; khác ⇒ null. Không đọc gì khác của gói.
   */
  pdf?(tenantId: string, fileRef: string): Promise<PartnerPdf | null>;
  /**
   * CR-126 · mẫu thư BÁO cho người nhận đã chọn khi bên nhận ĐÃ trên nền tảng (kênh nền tảng, có `to_email`): chỉ báo + nút vào hộp thư đối tác
   * trong app (đăng nhập mới xem/trả lời), KHÔNG đính hợp đồng, KHÔNG link trả lời không cần đăng nhập. Mẫu thuộc gói; bộ gửi hub chỉ gọi.
   */
  notice?(i: PartnerNoticeInput): PartnerNoticeMail;
  /**
   * CR-127 · P1 · phiên ký chung đổi trạng thái chưa báo (lô của bộ chuyển, dòng hub còn khoá): gói báo TỪNG bên có cờ chưa báo — chuyển HĐ
   * (#12–#14c) qua cổng + tín hiệu `sign.session.*`. Ném ⇒ bộ chuyển KHÔNG bật cờ (lượt sau thử lại); idempotent (cổng CAS, tín hiệu một lần).
   */
  onSignSessions?(rows: readonly SignSessionRow[]): Promise<void>;
};

/** CR-127 · P1 · một phiên ký chung cần báo. `status` đã gồm chuyển do hạn (proposed quá hạn ⇒ fallback, đang ký quá hạn ⇒ expired). */
export type SignSessionRow = {
  sessionId: string;
  status: "accepted" | "signing" | "done" | "cancelled" | "declined" | "expired" | "fallback";
  /** Quá hạn ký: bên gửi đã chọn Gửi lại / Dừng (null = chưa chọn). */
  expireChoice: "resend" | "stop" | null;
  fromTenant: string;
  toTenant: string;
  /** Bên còn cần báo (cờ `emitted_*` đang tắt). */
  notifyFrom: boolean;
  notifyTo: boolean;
  /** Bên đã huỷ / từ chối (null nếu không áp dụng). */
  cancelSide: "from" | "to" | null;
  cancelReason: string | null;
};

export type PartnerNoticeInput = {
  /** Tên công ty gửi (A). */
  senderName: string;
  /** Tên hợp đồng (tiêu đề bản chia sẻ). */
  title: string;
  /** Lời nhắn của bên gửi (nếu có). */
  message: string | null;
  /** Vòng gửi (≥ 2 ⇒ bản sửa). */
  round: number;
  /** Hạn trả lời. */
  expiresAt: Date;
  /** Đường dẫn tuyệt đối tới hộp thư đối tác trong app. */
  link: string;
};
export type PartnerNoticeMail = { subject: string; text: string; html: string };

export type PartnerPdf = { bytes: Uint8Array; name: string };

export type PartnerMailboxPortRegistry = {
  set(p: PartnerMailboxPort | undefined): void;
  get(): PartnerMailboxPort | undefined;
};
