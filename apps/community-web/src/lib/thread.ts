// Logic thuần của luồng bình luận (C6): ai được sửa/xoá/ẩn, công ty nào "Nhắn riêng" được.
import type { CommentView, PartnerOrg, PostView, ThreadSummary } from "@ai/contracts/community";
import { previewRecipients } from "./audience";

export type CommentActions = { edit: boolean; delete: boolean; hide: boolean };

/** Người viết sửa/xoá bình luận của mình; chủ quản ẩn/hiện mọi bình luận trên bài chủ quản (HT-46). */
export function commentActions(
  c: Pick<CommentView, "mine">,
  ctx: { isHost: boolean; postByHost: boolean },
): CommentActions {
  return { edit: c.mine, delete: c.mine, hide: ctx.isHost && ctx.postByHost };
}

/** Công ty chủ quản mở luồng riêng được: thuộc audience của bài chủ quản, chưa có luồng. Bài đối tác: không có. */
export function startablePartners(
  post: PostView,
  partners: PartnerOrg[],
  tabs: Pick<ThreadSummary, "orgId">[],
): PartnerOrg[] {
  if (post.authorSide !== "host") return [];
  const taken = new Set(tabs.map((t) => t.orgId));
  return previewRecipients(post.audience, post.type, post.cats, partners).filter(
    (p) => !taken.has(p.id),
  );
}
