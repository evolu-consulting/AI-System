// CR-129 · service bình luận phẳng (T-DEP-1): mỗi hàm MỘT tx gói. Ai thấy bình luận do RLS; nhắc công ty đối tác kiểm ở đây
// (`mentionAllowed` + bài thấy được công ty đó) VÀ ở RLS `comments_insert`. RLS chặn ghi (42501) ⇒ 404 như không thấy.
import type { Tx } from "@ai/db";
import { AppError, appError } from "../../../../lib/errors";
import type { NotifyTxRepos, PackUow, Person } from "../../kit/public";
import { mentionAllowed } from "../domain/comment-visibility.rules";
import type { StoredText } from "../domain/content.rules";
import { type CommentRow, insertComment, listComments, orgsSeeingPost } from "./comment-list.repo";
import type { Access } from "./community-access";
import { type CrossAdded, crossAdd, crossList, crossPostTenant } from "./cross-comment.repo";
import type { CommunityEvents } from "./notify.events";
import { assertSeen, isForeign, type MentionDeps, resolvePeople } from "./post-mention.service";
import { postState } from "./post-write.repo";

type Uow = PackUow<{ tx: Tx } & NotifyTxRepos>;

function rlsDenied(e: unknown): boolean {
  for (let x = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++)
    if ((x as { code?: string }).code === "42501") return true;
  return false;
}

const pgCode = (e: unknown): string | undefined => {
  for (let x = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    const c = (x as { code?: string }).code;
    if (c) return c;
  }
  return undefined;
};

const mentionUserNotAllowed = () =>
  new AppError("MENTION_USER_NOT_ALLOWED", 422, "Không nhắc được người này trên bài này");

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
  // CR-191: bài không ở tenant mình ⇒ (nội bộ) thử bài công ty đã kết nối — DEFINER kiểm hàng rào, cùng tx (2 câu cố định)
  const r = await uow.tenant(a.who, async ({ tx }) => {
    const own = await listComments(tx, postId, { ...page, limit: page.limit + 1 });
    return own.post || a.org !== null
      ? own
      : crossList(tx, postId, { ...page, limit: page.limit + 1 });
  });
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

export type AddReq = {
  postId: string;
  text: StoredText;
  mentions: readonly string[];
  mentionUserIds?: readonly string[] | undefined;
};
type AddDeps = { events?: CommunityEvents | undefined; mention?: MentionDeps | undefined };
type Ctx = { tx: Tx; a: Access; req: AddReq; people: readonly Person[] };

/** CR-191 · bài không ở tenant mình ⇒ bình luận chéo công ty (nội bộ, DEFINER kiểm hàng rào + người được nhắc). Người của công ty đăng
 * được nhắc phải có quyền gói ở công ty đó (thấy được bài — `hosts`); ngoài ⇒ 422. */
async function addCross(
  c: Ctx & { hosts?: MentionDeps["hosts"] | undefined },
): Promise<CrossAdded> {
  const { tx, a, req, people } = c;
  if (a.org !== null || req.mentions.length > 0) throw appError("NOT_FOUND");
  if (people.some((p) => p.org !== null)) throw mentionUserNotAllowed();
  const far = people.filter((p) => isForeign(p, a.who.tenantId));
  if (far.length > 0) {
    const t = await crossPostTenant(tx, req.postId);
    if (!t) throw appError("NOT_FOUND");
    const hosts = new Set(c.hosts ? await c.hosts(t) : []);
    if (!far.every((p) => p.tenant === t && hosts.has(p.id))) throw mentionUserNotAllowed();
  }
  const who = people.map((p) => ({ id: p.id, tenant: p.tenant ?? a.who.tenantId }));
  return crossAdd(tx, req.postId, req.text, who);
}

/** Bài ở tenant mình: kiểm nhắc (người + công ty) rồi ghi MỘT câu. */
async function addOwn(c: Ctx, authorOrg: string | null) {
  const { tx, a, req, people } = c;
  const mentions = [...new Set(req.mentions)];
  await assertSeen(tx, a, req.postId, people);
  if (mentions.length > 0) {
    const active = activeOrgIds(a);
    if (!mentions.every((m) => mentionAllowed(a.org, m, active))) throw notAllowed();
    const seeing = new Set(await orgsSeeingPost(tx, a.who.tenantId, req.postId, mentions));
    if (!mentions.every((m) => seeing.has(m))) throw notAllowed();
  }
  const row = await insertComment(tx, {
    tenantId: a.who.tenantId,
    postId: req.postId,
    userId: a.who.userId,
    authorName: a.dir.userName,
    authorOrg: a.org,
    text: req.text,
    mentions,
    people,
  });
  return { row, authorOrgOfPost: authorOrg };
}

/** Chuông bình luận chéo: ở tenant BÀI (người đăng + người công ty đăng được nhắc); người công ty mình được nhắc nhận ở tenant mình. */
const emitCross = (events: CommunityEvents | undefined, a: Access, postId: string, x: CrossAdded) =>
  events?.emitComment({
    tenantId: x.post_tenant,
    postId,
    commentId: x.comment.id,
    actor: { userId: a.who.userId, name: a.dir.userName },
    actorOrg: null,
    postAuthorOrg: null,
    mentions: [],
    mentionUsers: x.people.filter((p) => p.tenant === null).map((p) => p.id),
    foreignMentions: x.people.flatMap((p) =>
      p.tenant ? [{ userId: p.id, tenant: p.tenant }] : [],
    ),
    activeOrgs: [],
  });

/** review TB-2: chuông phát SAU commit (hỏi chủ quản = tx hub riêng, không lồng). */
const emitOwn = (
  events: CommunityEvents | undefined,
  c: Omit<Ctx, "tx">,
  r: { row: CommentRow; authorOrgOfPost: string | null },
) =>
  events?.emitComment({
    tenantId: c.a.who.tenantId,
    postId: c.req.postId,
    commentId: r.row.id,
    actor: { userId: c.a.who.userId, name: c.a.dir.userName },
    actorOrg: c.a.org,
    postAuthorOrg: r.authorOrgOfPost,
    mentions: [...new Set(c.req.mentions)],
    mentionUsers: c.people.filter((p) => !isForeign(p, c.a.who.tenantId)).map((p) => p.id),
    foreignMentions: c.people.flatMap((p) =>
      isForeign(p, c.a.who.tenantId) ? [{ userId: p.id, tenant: p.tenant as string }] : [],
    ),
    activeOrgs: activeOrgIds(c.a),
  });

/** Thêm bình luận (đã kiểm nhắc); chuông phát SAU commit. Trả hàng vừa tạo. CR-186: nhắc NGƯỜI — kiểm ngoài tx (người lạ/khoá/ngoài bên
 * ⇒ 422), trong tx: công ty người đó phải thấy bài. CR-191: nhắc được người công ty đã kết nối thấy bài; bài công ty kết nối ⇒ `addCross`. */
export async function add(
  uow: Uow,
  a: Access,
  req: AddReq,
  deps: AddDeps = {},
): Promise<CommentRow> {
  const people = await resolvePeople(deps.mention, a, req.mentionUserIds, true);
  const res = await uow
    .tenant(a.who, async ({ tx }) => {
      const st = await postState(tx, req.postId);
      const c = { tx, a, req, people };
      if (!st) return { cross: await addCross({ ...c, hosts: deps.mention?.hosts }) } as const;
      return { own: await addOwn(c, st.author_org) } as const;
    })
    .catch((e: unknown) => {
      if (pgCode(e) === "22023") throw mentionUserNotAllowed();
      throw rlsDenied(e) ? appError("NOT_FOUND") : e;
    });
  if ("cross" in res && res.cross) {
    await emitCross(deps.events, a, req.postId, res.cross);
    return res.cross.comment;
  }
  await emitOwn(deps.events, { a, req, people }, res.own);
  return res.own.row;
}
