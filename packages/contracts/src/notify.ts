// N3-FR-01 · N3-FR-04 · N3-FR-09 · contract thông báo dùng chung (spec N3-notify). Mọi object strict. Ghi thông báo đi qua
// `notify.enqueue` (SQL, trong tx nghiệp vụ); HTTP chỉ có phần người dùng cuối: đọc chuông, đã đọc, tùy chọn kênh, đăng ký push.
import { z } from "zod";

export const NOTIFY_KIND_RE = /^[a-z][a-z0-9_.]{1,40}$/;
/** Đường dẫn trong app (bắt đầu `/`, không `//` hay `/\`): chống mở URL ngoài từ thông báo. */
export const NOTIFY_LINK_RE = /^\/[^/\\]/;
export const NOTIFY_TITLE_MAX = 200;
export const NOTIFY_BODY_MAX = 2000;
export const NOTIFY_LINK_MAX = 500;
export const NOTIFY_DEDUP_MAX = 128;
export const NOTIFY_BATCH_MAX = 500;
export const NOTIFY_PAGE_MAX = 50;

export const NOTIFY_CHANNELS = ["email", "push"] as const;
export const NotifyChannelSchema = z.enum(NOTIFY_CHANNELS);
export type NotifyChannel = z.infer<typeof NotifyChannelSchema>;

/** Một thông báo gói/Hub muốn gửi (đầu vào của cổng). `dedup_key` vắng ⇒ DB sinh ngẫu nhiên (không idempotent). */
export const NotifyInputSchema = z
  .object({
    user_id: z.uuid(),
    kind: z.string().regex(NOTIFY_KIND_RE),
    title: z.string().min(1).max(NOTIFY_TITLE_MAX),
    body: z.string().max(NOTIFY_BODY_MAX).optional(),
    link: z.string().max(NOTIFY_LINK_MAX).regex(NOTIFY_LINK_RE).optional(),
    dedup_key: z.string().min(1).max(NOTIFY_DEDUP_MAX).optional(),
  })
  .strict();
export type NotifyInput = z.infer<typeof NotifyInputSchema>;

export const NotificationSchema = z
  .object({
    id: z.uuid(),
    seq: z.number().int(),
    source: z.string(),
    kind: z.string(),
    title: z.string(),
    body: z.string(),
    link: z.string().nullable(),
    created_at: z.string(),
    read: z.boolean(),
  })
  .strict();
export type Notification = z.infer<typeof NotificationSchema>;

/** `GET /notifications?limit=&before=` — `before` = `seq` của hàng cuối trang trước (con trỏ, không offset). */
export const NotificationListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(NOTIFY_PAGE_MAX).default(20),
    before: z.coerce.number().int().min(1).optional(),
  })
  .strict();
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const NotificationListSchema = z
  .object({
    items: z.array(NotificationSchema),
    unread: z.number().int().min(0),
    next_before: z.number().int().nullable(),
  })
  .strict();
export type NotificationList = z.infer<typeof NotificationListSchema>;

/** `POST /notifications/read` — `ids` (≤ 100) hoặc `all: true`; đúng một trong hai. */
export const MarkReadBodySchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(100).optional(), all: z.literal(true).optional() })
  .strict()
  .refine((b) => (b.ids === undefined) !== (b.all === undefined), {
    message: "ids hoặc all",
  });
export type MarkReadBody = z.infer<typeof MarkReadBodySchema>;
export const MarkReadResultSchema = z.object({ updated: z.number().int().min(0) }).strict();
export type MarkReadResult = z.infer<typeof MarkReadResultSchema>;

export const NotifyPrefsSchema = z.object({ email: z.boolean(), push: z.boolean() }).strict();
export type NotifyPrefs = z.infer<typeof NotifyPrefsSchema>;

export const PushKeySchema = z.object({ public_key: z.string().nullable() }).strict();
export type PushKey = z.infer<typeof PushKeySchema>;

/** Đăng ký push của trình duyệt (`PushSubscription.toJSON()`): endpoint https, khóa base64url. */
export const PushSubscriptionBodySchema = z
  .object({
    endpoint: z.url().max(2048).startsWith("https://"),
    keys: z
      .object({
        p256dh: z
          .string()
          .min(1)
          .max(256)
          .regex(/^[A-Za-z0-9_-]+$/),
        auth: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[A-Za-z0-9_-]+$/),
      })
      .strict(),
  })
  .strict();
export type PushSubscriptionBody = z.infer<typeof PushSubscriptionBodySchema>;

export const PushUnsubscribeBodySchema = z
  .object({ endpoint: z.url().max(2048).startsWith("https://") })
  .strict();
export type PushUnsubscribeBody = z.infer<typeof PushUnsubscribeBodySchema>;
