// HUB-FR-44, HUB-FR-75 · FB1 · kiểu Drizzle bảng `hub.attachments` (tách khỏi `hub.ts` cho trần 400 dòng; re-export ở `hub.ts`).
// CHỈ để truy vấn có kiểu — DDL thật: `migrations-hub/0007_h2c_attachments.sql`, `0023_x2b2_room_attachments.sql`,
// `0033_fb1_filebox_ref.sql` (viết tay). Ràng buộc (CHECK/FK/index) chỉ ở SQL. Định nghĩa cột/bảng KHÔNG đổi khi tách.
import { bigint, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { hub } from "./hub-readonly";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const owned = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
});

export const ATTACHMENT_ORIGIN_VALUES = ["upload", "output"] as const;

// ── H2c (0007_h2c_attachments): file đính kèm (RLS như bảng hội thoại; FK message_id SET NULL; CHECK ở SQL) ──
export const attachments = hub.table("attachments", {
  ...owned(),
  origin: text("origin", { enum: ATTACHMENT_ORIGIN_VALUES }).notNull(),
  /** NOT NULL ⇔ origin = output (CHECK `attachments_output_job_ck`). */
  jobId: uuid("job_id"),
  conversationId: uuid("conversation_id"),
  flowId: uuid("flow_id"),
  messageId: uuid("message_id"),
  roomId: uuid("room_id"), // 0023 X2b-2: NOT NULL ⇔ gắn tin phòng (message/conversation/flow NULL)
  roomMessageId: uuid("room_message_id"), // 0023: FK (room_message_id, room_id), SET NULL khi tin bị xoá
  position: smallint("position"), // thứ tự trong tin (0–9), đặt khi gắn (R12)
  filename: text("filename").notNull(),
  safeName: text("safe_name").notNull(),
  mime: text("mime").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  /** `<tenant_id>/<id>` (CHECK `attachments_key_ck`). */
  storageKey: text("storage_key").notNull(),
  // FB1 (0033, HUB-FR-138): tham chiếu FileBox khi kho = driver `filebox`; NULL ⇒ hàng kho `local`.
  fileboxFileId: text("filebox_file_id"),
  fileboxVersionId: text("filebox_version_id"),
  createdAt: createdAt(),
  boundAt: ts("bound_at"),
  purgedAt: ts("purged_at"),
});
