// CR-102 · C6 · CR-129 · service sửa/xoá/ẩn bình luận (T-DEP-1): mỗi hàm MỘT tx. Hàng không thuộc quyền ⇒ 404 như không thấy.
import type { Tx } from "@ai/db";
import { appError } from "../../../../lib/errors";
import type { PackUow } from "../../kit/public";
import type { StoredText } from "../domain/content.rules";
import { deleteComment, editComment, hideComment } from "./comment.repo";
import type { CommentRow } from "./comment-list.repo";
import type { Access } from "./community-access";
import { crossDelete, crossEdit } from "./cross-comment.repo";

type Uow = PackUow<{ tx: Tx }>;
type Ref = { postId: string; id: string };

const must = <T>(x: T | null | false): T => {
  if (x === null || x === false) throw appError("NOT_FOUND");
  return x;
};

/** Sửa bình luận của mình; CR-191: không có ở tenant mình ⇒ thử bình luận chéo (DEFINER, nội bộ). */
export const edit = (uow: Uow, a: Access, r: Ref, text: StoredText): Promise<CommentRow> =>
  uow.tenant(a.who, async ({ tx }) => {
    const own = await editComment(tx, { ...r, userId: a.who.userId, text });
    return must(own ?? (a.org === null ? await crossEdit(tx, { ...r, text }) : null));
  });

/** Xoá của mình; người đăng bài / quản trị (nội bộ) xoá mọi bình luận trên bài mình; CR-191: thử bình luận chéo. */
export const remove = (uow: Uow, a: Access, r: Ref): Promise<void> =>
  uow.tenant(a.who, async ({ tx }) => {
    const mod = a.org === null ? { mod: { admin: a.joinAdmin } } : {};
    const own = await deleteComment(tx, { ...r, userId: a.who.userId, ...mod });
    must(own || (a.org === null && (await crossDelete(tx, r))));
  });

/** Người đăng bài hoặc quản trị (nội bộ, ADR-0044 + CR-191); bài của đối tác không ẩn bình luận được (nội bộ ẩn cả bài thay vào đó). */
export const hide = (uow: Uow, a: Access, r: Ref, hidden: boolean): Promise<CommentRow> => {
  if (a.org !== null) throw appError("NOT_FOUND");
  return uow.tenant(a.who, async ({ tx }) =>
    must(await hideComment(tx, { ...r, hidden, userId: a.who.userId, admin: a.joinAdmin })),
  );
};
