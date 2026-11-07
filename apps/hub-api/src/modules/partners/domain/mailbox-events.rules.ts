// CR-124 · q1 · FLOW4-FR-07/11 · NFR-02 · khoá sự kiện hộp thư liên công ty (thuần, lớp 1). event_id suy từ `mailbox.id` ⇒
// bộ chuyển chạy lại / hai Hub cùng chạy vẫn MỘT sự kiện mỗi chiều (unique `(tenant_id, event_id)` của `hub.flow_events`).

export const PARTNER_OUTCOMES = ["confirmed", "returned", "declined"] as const;
export type PartnerOutcome = (typeof PARTNER_OUTCOMES)[number];

/** Sự kiện vào tenant NHẬN khi lần gửi kênh nền tảng tới nơi. */
export const RECEIVED_EVENT = "contract.received";

/** Sự kiện vào tenant GỬI khi có câu trả lời (node chờ `partner.confirmed` + `also_events`). */
export const replyEventOf = (o: PartnerOutcome): string => `partner.${o}`;

export const receivedEventId = (mailboxId: string): string => `partner:${mailboxId}`;
export const replyEventId = (mailboxId: string): string => `partner:${mailboxId}:reply`;

/** Kích thước lô mặc định (Luật 4c: lô 100, số câu SQL cố định). */
export const PARTNER_MOVE_BATCH = 100;
/** Nghỉ khi hết việc (vòng nền chạy liền khi còn việc). */
export const PARTNER_MOVE_IDLE_MS = 2_000;
