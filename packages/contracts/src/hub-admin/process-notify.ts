// CR-121 D-6 · node `notify` (họ work, không AI): Hub gửi thông báo (chuông, tuỳ chọn mail) tới người nhận theo vai/nhóm của công ty
// rồi xong bước ngay (không chờ người). Tiêu đề/nội dung là mẫu có biến `{khoá-input}` lấy từ input run. Không import `./processes`.
import { z } from "zod";
import { StageGroupKeySchema } from "./process-group-refs";
import { SourceKeySchema } from "./sources";

/** Chuông luôn có (thông báo trong app); `email` = gửi thêm mail theo tùy chọn của người nhận. */
export const NOTIFY_CHANNELS = ["bell", "email"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];
export const NOTIFY_TO_MAX = 5;
export const NOTIFY_TITLE_MAX = 200;
export const NOTIFY_BODY_MAX = 2000;

/** Người nhận: người bắt đầu lượt · thành viên Group (theo MÃ — def thư viện dùng chung nhiều công ty) · user id ở một input run. */
export const NotifyToSchema = z.discriminatedUnion("who", [
  z.strictObject({ who: z.literal("starter") }),
  z.strictObject({ who: z.literal("group"), group_key: StageGroupKeySchema }),
  z.strictObject({ who: z.literal("input_user"), input: SourceKeySchema }),
]);
export type NotifyTo = z.infer<typeof NotifyToSchema>;

/** Thiếu người nhận / kênh / tiêu đề ⇒ `NOTIFY_INVALID` khi lưu (luật `notifyDefIssues`), không chặn ở hình. */
export const NotifyExecutorSchema = z.strictObject({
  kind: z.literal("notify"),
  to: z.array(NotifyToSchema).max(NOTIFY_TO_MAX),
  channels: z.array(z.enum(NOTIFY_CHANNELS)).max(NOTIFY_CHANNELS.length),
  title: z.string().max(NOTIFY_TITLE_MAX),
  body: z.string().max(NOTIFY_BODY_MAX),
});
export type NotifyExecutor = z.infer<typeof NotifyExecutorSchema>;
