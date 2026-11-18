// CR-186 · schema lá dùng chung cho người được nhắc (bài đăng CR-145 + bình luận): không import file nào khác của gói ⇒ không vòng import.
import { z } from "zod";

/** Người được nhắc. Đối tác chỉ nhận phần tử là chủ quản hoặc công ty mình. */
export const PostMentionSchema = z.strictObject({ userId: z.string(), name: z.string() });
export type PostMention = z.infer<typeof PostMentionSchema>;
