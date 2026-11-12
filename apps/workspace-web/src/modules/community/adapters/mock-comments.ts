// Mock sửa/xoá/ẩn bình luận (C6), tách khỏi mock.ts cho đủ cỡ file. CR-129: trả `CommentView` (xoá: không trả gì), không còn "luồng".
import type { CommentView } from "@ai/contracts/community";
import type { CommunityApi } from "../application/ports";
import type { RawComment } from "./seed";

type Deps = {
  comments: RawComment[];
  view: (c: RawComment) => CommentView;
  mine: (c: RawComment) => boolean;
  mayHide: (postId: string) => boolean;
};

export function commentMutations(
  d: Deps,
): Pick<CommunityApi, "editComment" | "deleteComment" | "hideComment"> {
  const own = (postId: string, id: string, ok: boolean | ((c: RawComment) => boolean)) => {
    const c = d.comments.find((x) => x.id === id && x.postId === postId);
    if (!c || !(typeof ok === "boolean" ? ok : ok(c)))
      throw new Error("404 Không tìm thấy bình luận");
    return c;
  };
  return {
    editComment: async (postId, id, text) => {
      const c = own(postId, id, d.mine);
      c.text = text;
      return d.view(c);
    },
    deleteComment: async (postId, id) => {
      const c = own(postId, id, d.mine);
      d.comments.splice(d.comments.indexOf(c), 1);
    },
    hideComment: async (postId, id, hidden) => {
      const c = own(postId, id, d.mayHide(postId));
      c.hidden = hidden;
      return d.view(c);
    },
  };
}
