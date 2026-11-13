// CR-145 · «Nhắc tên» trong Composer: logic thuần (không i18n) — loại bài mặc định, chọn người, phạm vi gợi ý.
import { POST_MENTIONS_MAX, type PostAudience, type PostType } from "@ai/contracts/community";

/** Người được nhắc trong bản nháp (chip). */
export type DraftMention = { userId: string; name: string; orgName?: string };

/** Loại bài mặc định: chủ quản (được đăng «Thông báo») ⇒ `note`; đối tác ⇒ loại đầu tiên được phép. */
export const defaultPostType = (allowed: readonly PostType[]): PostType =>
  allowed.includes("note") ? "note" : (allowed[0] ?? "sell");

/** Thêm một người vào danh sách nhắc: không trùng, tối đa `POST_MENTIONS_MAX`. */
export const addMention = (list: DraftMention[], m: DraftMention): DraftMention[] =>
  list.some((x) => x.userId === m.userId) || list.length >= POST_MENTIONS_MAX ? list : [...list, m];

export const mentionIds = (list: readonly DraftMention[]): string[] => list.map((m) => m.userId);

/** Phạm vi bản nháp gửi server để biết «ai thấy được bài» (gợi ý người nhắc). Đối tác không có `audience` ⇒ server tự giới hạn. */
export const mentionScope = (d: { type: PostType; cats: string[]; audience?: PostAudience }) => ({
  type: d.type,
  cats: d.cats,
  ...(d.audience
    ? {
        mode: d.audience.mode,
        audCats: [...d.audience.cats],
        companies: [...d.audience.companies],
      }
    : {}),
});
