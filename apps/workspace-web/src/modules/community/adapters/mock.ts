// CR-102 · C5 · adapter mock in-memory: cùng hợp đồng với server C3 (hien-thi.md): che liên hệ cho user ngoài, raw + hits cho chủ quản,
// luồng bình luận theo (bài × công ty), không bao giờ trả `saveQuote` cho đối tác. Thay persona bằng `setPersona` (chỉ dev).

import {
  type CommentView,
  type CommunityViewer,
  type ContentHit,
  isHost,
  type PostAction,
  type PostView,
} from "@ai/contracts/community";
import type { CommunityApi } from "../application/ports";
import { applyFeedQuery, countTabs, uniqueSorted } from "../domain/filters";
import { applyMask, detectHits, type MaskContext } from "../domain/mask";
import { canViewPost, defaultAudience } from "../domain/visibility";
import { commentMutations } from "./mock-comments";
import { fileMock } from "./mock-files";
import { flowsMock } from "./mock-flows";
import { profileMock } from "./mock-profile";
import { quoteEnvOf, quoteMock } from "./mock-quote";
import { settingsMock } from "./mock-settings";
import {
  CATS,
  HOST_ORG,
  PARTNERS,
  PERSONAS,
  type RawComment,
  type RawPost,
  SEED_COMMENTS,
  SEED_POSTS,
} from "./seed";

export { PERSONAS };

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const DAY = 1440;

export function createMockApi(): { api: CommunityApi; setPersona: (id: string) => void } {
  let me: CommunityViewer = PERSONAS[0] as CommunityViewer;
  const quoteEnv = quoteEnvOf(() => isHost(me));
  let seq = 100;
  const posts: RawPost[] = structuredClone(SEED_POSTS);
  const comments: RawComment[] = structuredClone(SEED_COMMENTS);
  const orgName = (id: string) =>
    id === HOST_ORG.id ? HOST_ORG.name : (PARTNERS.find((p) => p.id === id)?.name ?? id);
  const sideOf = (orgId: string) => (orgId === HOST_ORG.id ? "host" : "partner");
  const get = (id: string): RawPost => {
    const p = posts.find((x) => x.id === id);
    if (!p) throw new Error("404 Không tìm thấy bài");
    return p;
  };
  const ctxFor = (authorOrgId: string): MaskContext => ({
    ownOrgName: orgName(authorOrgId),
    otherOrgNames: [...PARTNERS.map((p) => p.name), HOST_ORG.name],
  });
  const hitsOf = (p: RawPost): ContentHit[] =>
    p.authorOrgId === HOST_ORG.id
      ? []
      : [
          ...detectHits(p.title, "title", ctxFor(p.authorOrgId)),
          ...detectHits(p.body, "body", ctxFor(p.authorOrgId)),
        ];
  const visible = (p: RawPost) =>
    canViewPost({ ...p, authorSide: sideOf(p.authorOrgId), audience: p.audience }, me);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: adapter mock mô phỏng quy tắc hien-thi.md
  const actionsFor = (p: RawPost): PostAction[] => {
    const own = p.authorOrgId === me.orgId;
    const out: PostAction[] = [];
    if (own) {
      out.push("edit", p.status === "active" ? "archive" : "unarchive");
      if (p.status === "active" && p.type !== "note") out.push("done");
      out.push("delete");
    } else if (isHost(me)) {
      out.push(p.hidden ? "unhide" : "hide");
      if (p.type === "sell") out.push("saveQuote");
    }
    return out;
  };

  // Luật xem (CR-129): chủ quản thấy hết; đối tác (không bị ẩn) thấy bình luận của chủ quản, của công ty mình, trên bài của mình, hoặc nhắc mình.
  const seesComment = (c: RawComment, p: RawPost) =>
    isHost(me) ||
    (!c.hidden &&
      (c.authorOrgId === HOST_ORG.id ||
        c.authorOrgId === me.orgId ||
        p.authorOrgId === me.orgId ||
        (c.mentions ?? []).includes(me.orgId)));
  const visibleComments = (p: RawPost) =>
    comments.filter((c) => c.postId === p.id && seesComment(c, p));
  const commentCount = (p: RawPost) => visibleComments(p).length;

  const toView = (p: RawPost): PostView => {
    const host = isHost(me);
    const hits = hitsOf(p);
    const masked = !host && p.authorOrgId !== HOST_ORG.id;
    const t = hits.filter((h) => h.field === "title");
    const b = hits.filter((h) => h.field === "body");
    const base: PostView = {
      id: p.id,
      type: p.type,
      authorOrgId: p.authorOrgId,
      authorOrgName: orgName(p.authorOrgId),
      authorName: p.authorName,
      authorSide: sideOf(p.authorOrgId),
      createdAt: iso(p.createdMinAgo),
      expiresAt: iso(p.createdMinAgo - 30 * DAY),
      edited: p.edited,
      status: p.status,
      title: masked ? applyMask(p.title, t) : p.title,
      body: masked ? applyMask(p.body, b) : p.body,
      fields: p.fields,
      cats: p.cats,
      media: p.media.map((m, i) => ({ id: `${p.id}-m${i}`, ...m })),
      commentCount: commentCount(p),
      actions: actionsFor(p),
    };
    if (host) {
      return {
        ...base,
        ...quoteEnv.quotesOf(p.id),
        hidden: p.hidden,
        ...(hits.length ? { hits } : {}),
        ...(p.authorOrgId === HOST_ORG.id ? { audience: p.audience } : {}),
      };
    }
    return base; // đối tác không nhận hidden/hits/audience của bài chủ quản
  };

  const mineComment = (c: RawComment) => c.authorOrgId === me.orgId && c.authorName === me.name;
  const hostOwns = (id: string) => isHost(me) && get(id).authorOrgId === HOST_ORG.id;
  const commentView = (c: RawComment): CommentView => {
    const host = isHost(me);
    const partnerText = c.authorOrgId !== HOST_ORG.id;
    const hits = partnerText ? detectHits(c.text, "body", ctxFor(c.authorOrgId)) : [];
    return {
      id: c.id,
      authorName: c.authorName,
      authorOrgId: c.authorOrgId,
      authorOrgName: orgName(c.authorOrgId),
      authorSide: sideOf(c.authorOrgId),
      text: !host && partnerText ? applyMask(c.text, hits) : c.text,
      ...(host && hits.length ? { hits } : {}),
      createdAt: iso(c.minAgo),
      ...(host ? { hidden: c.hidden } : {}),
      mine: mineComment(c),
      mentions: (c.mentions ?? [])
        .filter((id) => host || id === me.orgId)
        .map((id) => ({ orgId: id, name: orgName(id) })),
    };
  };
  /** Công ty chủ quản nhắc được: mọi đối tác chưa rời (mock không tính audience). Đối tác: rỗng. */
  const mentionables = (q?: string) =>
    isHost(me)
      ? PARTNERS.filter(
          (p) => !p.left && p.name.toLowerCase().includes((q ?? "").trim().toLowerCase()),
        )
          .slice(0, 20)
          .map((p) => ({ orgId: p.id, name: p.name }))
      : [];

  const api: CommunityApi = {
    getViewer: async () => me,
    getBrand: async () => ({ name: HOST_ORG.name, appName: null, logo: null, accent: "indigo" }),
    getBrandCover: async () => ({ cover: null }),
    ...profileMock(
      () => me,
      () => ({ posts, comments }),
      visible,
    ),
    listCats: async () => CATS,
    listFeed: async (q) => {
      const base = posts
        .filter(
          (p) =>
            visible(p) &&
            (!q.mine || p.authorOrgId === me.orgId) &&
            (!q.authorUserId || p.authorName === me.name),
        )
        .map(toView);
      const items = applyFeedQuery(base, q);
      return {
        items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        counts: countTabs(base, q),
        facets: {
          cats: uniqueSorted(base.flatMap((p) => p.cats)),
          areas: uniqueSorted(base.map((p) => p.fields.area ?? "")),
        },
      };
    },
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: adapter mock mô phỏng quy tắc hien-thi.md
    createPost: async (input) => {
      if (me.role === "partner" && input.audience)
        throw new Error("422 Đối tác không chọn người xem");
      if (
        me.role === "partner" &&
        ((input.type === "sell" && !me.labels.includes("supplier")) ||
          (input.type === "buy" && !me.labels.includes("customer")) ||
          input.type === "note")
      )
        throw new Error("403 Loại bài này không dành cho công ty bạn");
      const p: RawPost = {
        id: `p${++seq}`,
        type: input.type,
        authorOrgId: me.orgId,
        authorName: me.name,
        createdMinAgo: 0,
        status: "active",
        hidden: false,
        edited: false,
        title: input.title,
        body: input.body,
        fields: input.fields as RawPost["fields"],
        cats: input.cats,
        media: input.media.map((m) => ({
          kind: m.kind,
          label: m.label,
          fileId: m.fileId,
          name: m.name,
          size: m.size,
          mime: m.mime,
        })),
        audience: input.audience ?? defaultAudience(input.type),
      };
      posts.unshift(p);
      return toView(p);
    },
    updatePost: async (id, input) => {
      const p = get(id);
      if (p.authorOrgId !== me.orgId) throw new Error("403 Chỉ người đăng được sửa");
      Object.assign(p, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.cats ? { cats: input.cats } : {}),
        ...(input.audience ? { audience: input.audience } : {}),
        ...(input.fields ? { fields: { ...p.fields, ...input.fields } } : {}),
        edited: true,
      });
      return toView(p);
    },
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: adapter mock mô phỏng quy tắc hien-thi.md
    postAction: async (id, { action }) => {
      const p = get(id);
      if (!visible(p) || !actionsFor(p).includes(action as PostAction))
        throw new Error("404 Không tìm thấy bài");
      if (action === "delete") {
        posts.splice(posts.indexOf(p), 1);
        for (let i = comments.length - 1; i >= 0; i--)
          if (comments[i]?.postId === id) comments.splice(i, 1);
        return null;
      }
      if (action === "archive") p.status = "archived";
      else if (action === "unarchive") p.status = "active";
      else if (action === "done") p.status = "done";
      else p.hidden = action === "hide";
      return toView(p);
    },
    getPostSource: async (id) => {
      const p = get(id); // mock: bài thô = nguồn; quyền xem raw do server C3 kiểm (HT-52)
      return { id, title: p.title, body: p.body, fields: p.fields };
    },
    listComments: async (postId) => {
      const p = get(postId);
      if (!visible(p)) throw new Error("404 Không tìm thấy bài");
      const list = visibleComments(p).sort((a, b) => b.minAgo - a.minAgo);
      return { comments: list.map(commentView) };
    },
    listMentionables: async (postId, q) => {
      if (!visible(get(postId))) throw new Error("404 Không tìm thấy bài");
      return mentionables(q);
    },
    mentionablePeople: async (q) =>
      me.role === "partner"
        ? []
        : [
            { userId: "u-lan", name: "Lan (Kế toán)" },
            { userId: "u-minh", name: "Minh (Mua hàng)" },
            { userId: "u-hung", name: "Hùng", orgName: "Hùng Thịnh" },
          ].filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase())),
    addComment: async (postId, input) => {
      const p = get(postId);
      if (!visible(p)) throw new Error("404 Không tìm thấy bài");
      const ids = input.mentions ?? [];
      const allowed = new Set(mentionables().map((m) => m.orgId));
      if (ids.some((id) => !allowed.has(id)))
        throw Object.assign(new Error("422 MENTION_NOT_ALLOWED"), { code: "MENTION_NOT_ALLOWED" });
      const c: RawComment = {
        id: `c${++seq}`,
        postId,
        authorOrgId: me.orgId,
        authorName: me.name,
        text: input.text,
        minAgo: 0,
        hidden: false,
        mentions: ids,
      };
      comments.push(c);
      return commentView(c);
    },
    ...commentMutations({ comments, view: commentView, mine: mineComment, mayHide: hostOwns }),
    ...fileMock(),
    ...flowsMock(),
    ...settingsMock(() => me.userId),
    ...quoteMock(quoteEnv),
  };

  return {
    api,
    setPersona: (id) => {
      me = PERSONAS.find((p) => p.id === id) ?? me;
    },
  };
}
