// CR-129 · service bình luận phẳng (T-DEP-1): mỗi hàm MỘT tx gói. Ai thấy bình luận do RLS; nhắc công ty đối tác kiểm ở đây
// (`mentionAllowed` + bài thấy được công ty đó) VÀ ở RLS `comments_insert`. RLS chặn ghi (42501) ⇒ 404 như không thấy.
import type { Tx } from "@ai/db";
import { AppError, appError } from "../../../../lib/errors";
import type { NotifyTxRepos, PackUow } from "../../kit/public";
import { mentionAllowed } from "../domain/comment-visibility.rules";
import type { StoredText } from "../domain/content.rules";
import { type CommentRow, insertComment, listComments, orgsSeeingPost } from "./comment-list.repo";
import type { Access } from "./community-access";
import type { CommunityEvents } from "./notify.events";
import { assertSeen, type MentionDeps, resolvePeople } from "./post-mention.service";
import { postState } from "./post-write.repo";

type Uow = PackUow<{ tx: Tx } & NotifyTxRepos>;

function rlsDenied(e: unknown): boolean {
  for (let x = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++)
    if ((x as { code?: string }).code === "42501") return true;
  return false;
}

const notAllowed = () =>
  new AppError("MENTION_NOT_ALLOWED", 422, "Không nhắc được công ty này trên bài này");

const activeOrgIds = (a: Access): string[] => a.dir.orgs.filter((o) => o.active).map((o) => o.id);

/** Một trang bình luận (cũ → mới) + có trang sau không. Bài không thấy ⇒ 404. */
export async function list(
  uow: Uow,
  a: Access,
  postId: string,
  page: {
    cursor: { at: string; id: string } | null;
    limit: number;
    dir?: "asc" | "desc";
    beforeId?: string | undefined;
  },
): Promise<{ rows: CommentRow[]; more: boolean }> {
  const r = await uow.tenant(a.who, ({ tx }) =>
    listComments(tx, postId, { ...page, limit: page.limit + 1 }),
  );
  if (!r.post) throw appError("NOT_FOUND");
  // fix-review-r1 · `before` không có / không thấy được trên bài này ⇒ 400 rõ mã (không trả [] im lặng như hết bình luận).
  if (r.beforeOk === false)
    throw new AppError(
      "COMMENT_BEFORE_NOT_FOUND",
      400,
      "Bình luận mốc (before) không tồn tại hoặc không thấy được",
    );
  return { rows: r.comments.slice(0, page.limit), more: r.comments.length > page.limit };
}

/** Thêm bình luận (đã kiểm nhắc); chuông phát SAU commit. Trả hàng vừa tạo. */
export async function add(
  uow: Uow,
  a: Access,
  postId: string,
  input: { text: StoredText; mentions: readonly string[]; mentionUserIds?: readonly string[] },
  events?: CommunityEvents,
  mention?: MentionDeps,
): Promise<CommentRow> {
  const mentions = [...new Set(input.mentions)];
  // CR-186: nhắc NGƯỜI — kiểm ngoài tx như bài đăng (người lạ/khoá/ngoài bên ⇒ 422), rồi trong tx: công ty người đó phải thấy bài.
  const people = await resolvePeople(mention, a, input.mentionUserIds);
  const { row, authorOrgOfPost } = await uow
    .tenant(a.who, async ({ tx }) => {
      const st = await postState(tx, postId);
      if (!st) throw appError("NOT_FOUND");
      await assertSeen(tx, a, postId, people);
      if (mentions.length > 0) {
        const active = activeOrgIds(a);
        if (!mentions.every((m) => mentionAllowed(a.org, m, active))) throw notAllowed();
        const seeing = new Set(await orgsSeeingPost(tx, a.who.tenantId, postId, mentions));
        if (!mentions.every((m) => seeing.has(m))) throw notAllowed();
      }
      const row = await insertComment(tx, {
        tenantId: a.who.tenantId,
        postId,
        userId: a.who.userId,
        authorName: a.dir.userName,
        authorOrg: a.org,
        text: input.text,
        mentions,
        people,
      });
      return { row, authorOrgOfPost: st.author_org };
    })
    .catch((e: unknown) => {
      throw rlsDenied(e) ? appError("NOT_FOUND") : e;
    });
  // review TB-2: chuông phát SAU commit (hỏi chủ quản = tx hub riêng, không lồng)
  await events?.emitComment({
    tenantId: a.who.tenantId,
    postId,
    commentId: row.id,
    actor: { userId: a.who.userId, name: a.dir.userName },
    actorOrg: a.org,
    postAuthorOrg: authorOrgOfPost,
    mentions,
    mentionUsers: people.map((p) => p.id),
    activeOrgs: activeOrgIds(a),
  });
  return row;
}
