// Ngữ cảnh trang cho trợ lý chung (một trợ lý cho cả Sổ Hợp Tác và Cộng đồng): từ khoá đang tìm trên Bảng tin. Thuần, không I/O.
const SELECTION_MAX = 200;

/** Từ khoá đang tìm, gọn khoảng trắng, ≤ 200 ký tự; rỗng ⇒ null. */
export function trimSearch(search: string | undefined): string | null {
  const q = search?.replace(/\s+/g, " ").trim().slice(0, SELECTION_MAX);
  return q || null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CR-130 · thông báo Bảng tin trỏ `/community?post=<uuid>`: id bài cần cuộn tới; sai dạng ⇒ null. */
export function focusPostId(search: string): string | null {
  const id = new URLSearchParams(search).get("post");
  return id && UUID.test(id) ? id : null;
}

/** CR-129 · chuông bình luận trỏ `?post=<uuid>&comment=<uuid>`: id bình luận cần cuộn tới; sai dạng ⇒ null. */
export function focusCommentId(search: string): string | null {
  const id = new URLSearchParams(search).get("comment");
  return id && UUID.test(id) ? id : null;
}

/** Thẻ bài `postId` phải mở sẵn bình luận khi URL là `?post=<postId>&comment=<id>` (bấm thông báo @nhắc/bình luận). */
export const opensCommentThread = (search: string, postId: string): boolean =>
  focusPostId(search) === postId && focusCommentId(search) !== null;

/** CR-186 · mở bài lần đầu thấy SẴN bình luận mới nhất: bài có ≥ 1 bình luận mở khối bình luận ngay (bài chưa có ⇒ gập, bấm «Bình luận» để viết). */
export const opensThreadByDefault = (
  search: string,
  postId: string,
  commentCount: number,
): boolean => commentCount > 0 || opensCommentThread(search, postId);
