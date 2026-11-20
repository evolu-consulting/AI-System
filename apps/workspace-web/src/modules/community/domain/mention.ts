// CR-145 · «Nhắc tên» trong Composer: logic thuần (không i18n) — loại bài mặc định, chọn người, phạm vi gợi ý.
import { POST_MENTIONS_MAX, type PostAudience, type PostType } from "@ai/contracts/community";

/** Người được nhắc trong bản nháp (chip). */
export type DraftMention = {
  userId: string;
  name: string;
  orgName?: string;
  /** CR-191 · người công ty ĐÃ KẾT NỐI: id tenant + đang NGOÀI «Ai thấy bài» (chờ «Thêm công ty vào» / «Bỏ nhắc»). */
  tenantId?: string;
  outside?: boolean;
};

/** Người được chọn trong danh sách thả «@» ⇒ chip nháp. */
export const toMention = (o: {
  userId: string;
  name: string;
  orgName?: string | undefined;
  tenantId?: string | undefined;
  outside?: boolean | undefined;
}): DraftMention => ({
  userId: o.userId,
  name: o.name,
  ...(o.orgName ? { orgName: o.orgName } : {}),
  ...(o.tenantId ? { tenantId: o.tenantId } : {}),
  ...(o.outside ? { outside: true } : {}),
});

/** Loại bài mặc định: chủ quản (được đăng «Thông báo») ⇒ `note`; đối tác ⇒ loại đầu tiên được phép. */
export const defaultPostType = (allowed: readonly PostType[]): PostType =>
  allowed.includes("note") ? "note" : (allowed[0] ?? "sell");

/** Thêm một người vào danh sách nhắc: không trùng, tối đa `POST_MENTIONS_MAX`. */
export const addMention = (list: DraftMention[], m: DraftMention): DraftMention[] =>
  list.some((x) => x.userId === m.userId) || list.length >= POST_MENTIONS_MAX ? list : [...list, m];

export const mentionIds = (list: readonly DraftMention[]): string[] => list.map((m) => m.userId);

/** CR-191 · «@» trong THÂN bài: chỉ người còn được viết «@Tên» trong chữ mới được nhắc (xoá chữ ⇒ bỏ nhắc). */
export const mentionsInBody = (body: string, list: readonly DraftMention[]): DraftMention[] =>
  list.filter((m) => body.includes(`@${m.name}`));

/** Bỏ «@Tên» khỏi thân bài (Bỏ nhắc). */
export const stripMention = (body: string, name: string): string =>
  body.replace(`@${name}`, "").replace(/ {2,}/g, " ");

/** Phạm vi bản nháp gửi server để biết «ai thấy được bài» (gợi ý người nhắc). Đối tác không có `audience` ⇒ server tự giới hạn. */
export const mentionScope = (d: { type: PostType; cats: string[]; audience?: PostAudience }) => ({
  type: d.type,
  cats: d.cats,
  ...(d.audience
    ? {
        mode: d.audience.mode,
        audCats: [...d.audience.cats],
        companies: [...d.audience.companies],
        tenants: [...(d.audience.tenants ?? [])],
      }
    : {}),
  outside: true,
});
