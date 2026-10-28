// CR-102 · C6 · móc thông báo bình luận (stub). C9 thay thân hàm bằng ghi thông báo thật; route chỉ gọi ở đây.
export type CommentEvent = {
  kind: "added" | "edited" | "deleted" | "hidden";
  tenantId: string;
  postId: string;
  threadOrg: string;
  actorUserId: string;
  /** null = chủ quản. */
  actorOrg: string | null;
};

export async function notifyComment(_e: CommentEvent): Promise<void> {
  // C9: lập thông báo (comment/reply) cho bên kia của luồng.
}
