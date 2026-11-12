// CR-129 · luật thuần "ai thấy bình luận / ai được nhắc" (nghiep-vu §6, hien-thi §3). Trùng vị từ RLS `comments_visible` /
// `comments_insert` (0015) và hàm SQL `community.sides_friend`. "Bên" = `ext_org_id` của công ty đối tác; `null` = chủ quản.
// Mạng sao: bạn bè = cùng bên HOẶC một phía là chủ quản. Mở kết bạn đối tác↔đối tác sau này chỉ đổi `isFriend` (+ hàm SQL).

export type Side = string | null;

export type CommentCtx = {
  authorOrg: Side;
  /** Bên đăng bài (null = chủ quản). */
  postAuthorOrg: Side;
  /** Công ty đối tác được nhắc (`mention_orgs`). */
  mentions: readonly string[];
  hidden: boolean;
};

export const isFriend = (a: Side, b: Side): boolean => a === b || a === null || b === null;

/**
 * Người xem (đã thấy bài) có thấy bình luận không: chủ quản thấy tất cả (kể cả bị ẩn); đối tác không thấy bình luận bị ẩn
 * và chỉ thấy khi (tác giả là bạn) hoặc (bài là của chính công ty mình) hoặc (được nhắc).
 */
export function canSeeComment(viewer: Side, c: CommentCtx): boolean {
  if (viewer === null) return true;
  if (c.hidden) return false;
  return isFriend(c.authorOrg, viewer) || c.postAuthorOrg === viewer || c.mentions.includes(viewer);
}

/** Người viết `writer` được nhắc công ty `target` không: không nhắc chính bên mình, phải là bạn và còn hiệu lực. */
export function mentionAllowed(
  writer: Side,
  target: string,
  activeOrgs: readonly string[],
): boolean {
  return target !== writer && isFriend(writer, target) && activeOrgs.includes(target);
}
