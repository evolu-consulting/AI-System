// CR-102 · C6 · service sửa/xoá/ẩn bình luận (T-DEP-1): mỗi hàm MỘT tx. Hàng không thuộc quyền ⇒ 404 như không thấy.
import type { Tx } from "@ai/db";
import { appError } from "../../../../lib/errors";
import type { PackUow } from "../../kit/application/ports";
import type { StoredText } from "../domain/content.rules";
import { deleteComment, editComment, hideComment } from "./comment.repo";
import type { Access } from "./community-access";

type Uow = PackUow<{ tx: Tx }>;
type Ref = { postId: string; id: string };

const must = (org: string | null): string => {
  if (org === null) throw appError("NOT_FOUND");
  return org;
};

export const edit = (uow: Uow, a: Access, r: Ref, text: StoredText) =>
  uow.tenant(a.who, async ({ tx }) =>
    must(await editComment(tx, { ...r, userId: a.who.userId, text })),
  );

export const remove = (uow: Uow, a: Access, r: Ref) =>
  uow.tenant(a.who, async ({ tx }) =>
    must(await deleteComment(tx, { ...r, userId: a.who.userId })),
  );

/** Chỉ chủ quản; bài của đối tác không ẩn bình luận được (chủ quản ẩn cả bài thay vào đó). */
export const hide = (uow: Uow, a: Access, r: Ref, hidden: boolean) => {
  if (a.org !== null) throw appError("NOT_FOUND");
  return uow.tenant(a.who, async ({ tx }) => must(await hideComment(tx, { ...r, hidden })));
};
