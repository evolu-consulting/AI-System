// CR-102 · C5 · adapter mock in-memory: cùng hợp đồng với server C3 (hien-thi.md): che liên hệ cho user ngoài, raw + hits cho chủ quản,
// luồng bình luận theo (bài × công ty), không bao giờ trả `saveQuote` cho đối tác. Thay persona bằng `setPersona` (chỉ dev).
import {
  type CommentView,
  type CommunityNotification,
  type CommunitySettings,
  type CommunityViewer,
  type ContentHit,
  DEFAULT_SETTINGS,
  isHost,
  type PartnerOrg,
  type PostAction,
  type PostView,
  type Thread,
  type ThreadSummary,
} from "@ai/contracts/community";
import { applyFeedQuery, countTabs, uniqueSorted } from "../lib/filters";
import { applyMask, detectHits, type MaskContext } from "../lib/mask";
import { canViewPost, defaultAudience } from "../lib/visibility";
import type { ChatReply, CommunityApi } from "./client";
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

type Notif = CommunityNotification & { to: string };

export function createMockApi(): { api: CommunityApi; setPersona: (id: string) => void } {
  let me: CommunityViewer = PERSONAS[0] as CommunityViewer;
  let seq = 100;
  const posts: RawPost[] = structuredClone(SEED_POSTS);
  const comments: RawComment[] = structuredClone(SEED_COMMENTS);
  const settings = new Map<string, CommunitySettings>();
  const notifs: Notif[] = [
    {
      id: "n1",
      to: "host",
      kind: "comment",
      actorName: "Hưng Thịnh Logistics",
      text: "bình luận bài Chữ ký số DN – USB Token",
      postId: "p1",
      orgId: "hungthinh",
      createdAt: iso(35),
      unread: true,
    },
    {
      id: "n2",
      to: "host",
      kind: "newBuy",
      actorName: "Công ty TNHH ABC",
      text: "đăng bài Cần mua Chữ ký số DN – USB Token",
      postId: "p6",
      createdAt: iso(25),
      unread: true,
    },
    {
      id: "n3",
      to: "host",
      kind: "newSell",
      actorName: "Cơ sở Tân Phát",
      text: "đăng bài Cần bán Băng keo 5cm",
      postId: "p5",
      createdAt: iso(180),
      unread: false,
    },
    {
      id: "n4",
      to: "tanphat",
      kind: "reply",
      actorName: "Nguyễn Văn An",
      text: "trả lời bình luận của bạn",
      postId: "p5",
      createdAt: iso(90),
      unread: true,
    },
  ];

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

  const commentCount = (p: RawPost) =>
    comments.filter(
      (c) => c.postId === p.id && (isHost(me) || (c.threadOrgId === me.orgId && !c.hidden)),
    ).length;

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
        hidden: p.hidden,
        ...(hits.length ? { hits } : {}),
        ...(p.authorOrgId === HOST_ORG.id ? { audience: p.audience } : {}),
      };
    }
    return p.authorOrgId === me.orgId ? base : base; // đối tác không nhận hidden/hits/audience của bài chủ quản
  };

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
      mine: c.authorOrgId === me.orgId && c.authorName === me.name,
    };
  };

  const thread = (postId: string, orgId: string): Thread => {
    const org = isHost(me) ? orgId : me.orgId;
    const list = comments
      .filter((c) => c.postId === postId && c.threadOrgId === org && (isHost(me) || !c.hidden))
      .sort((a, b) => b.minAgo - a.minAgo);
    return {
      postId,
      orgId: org,
      orgName: orgName(org),
      count: list.length,
      comments: list.map(commentView),
      ...(list.length ? { lastAt: iso(Math.min(...list.map((c) => c.minAgo))) } : {}),
    };
  };

  const notifyKey = (): string => (isHost(me) ? "host" : me.orgId);
  const push = (n: Omit<Notif, "id" | "createdAt" | "unread">) =>
    notifs.unshift({ ...n, id: `n${++seq}`, createdAt: iso(0), unread: true });

  const api: CommunityApi = {
    getViewer: async () => me,
    listPartners: async (): Promise<PartnerOrg[]> =>
      isHost(me) ? PARTNERS : PARTNERS.filter((p) => p.id === me.orgId),
    listCats: async () => CATS,
    listFeed: async (q) => {
      const base = posts
        .filter((p) => visible(p) && (!q.mine || p.authorOrgId === me.orgId))
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
          (input.type === "buy" && !me.labels.includes("buyer")) ||
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
        media: input.media.map((m) => ({ kind: m.kind, label: m.label })),
        audience: input.audience ?? defaultAudience(input.type),
      };
      posts.unshift(p);
      if (!isHost(me))
        push({
          to: "host",
          kind: p.type === "sell" ? "newSell" : "newBuy",
          actorName: me.orgName,
          text: `đăng bài ${p.type === "sell" ? "Cần bán" : "Cần mua"} ${p.fields.product ?? ""}`,
          postId: p.id,
        });
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
    updatePartner: async (orgId, input) => {
      const o = PARTNERS.find((p) => p.id === orgId) as PartnerOrg;
      return Object.assign(o, { labels: [...new Set(input.labels)], cats: input.cats ?? [] });
    },
    listThreads: async (postId): Promise<ThreadSummary[]> => {
      const p = get(postId);
      if (!visible(p)) throw new Error("404 Không tìm thấy bài");
      const orgs = isHost(me)
        ? [
            ...new Set([
              ...comments.filter((c) => c.postId === postId).map((c) => c.threadOrgId),
              ...(p.authorOrgId !== HOST_ORG.id ? [p.authorOrgId] : []),
            ]),
          ]
        : [me.orgId];
      return orgs.map((o) => {
        const { comments: _c, ...s } = thread(postId, o);
        return s;
      });
    },
    getThread: async (postId, orgId) => {
      if (!visible(get(postId))) throw new Error("404 Không tìm thấy bài");
      return thread(postId, orgId);
    },
    addComment: async (postId, input) => {
      const p = get(postId);
      if (!visible(p)) throw new Error("404 Không tìm thấy bài");
      const org = isHost(me) ? (input.orgId ?? p.authorOrgId) : me.orgId;
      comments.push({
        id: `c${++seq}`,
        postId,
        threadOrgId: org,
        authorOrgId: me.orgId,
        authorName: me.name,
        text: input.text,
        minAgo: 0,
        hidden: false,
      });
      if (isHost(me))
        push({
          to: org,
          kind: "reply",
          actorName: me.name,
          text: "trả lời bình luận của bạn",
          postId,
        });
      else
        push({
          to: "host",
          kind: "comment",
          actorName: me.orgName,
          text: `bình luận bài ${p.fields.product ?? "của bạn"}`,
          postId,
          orgId: org,
        });
      return thread(postId, org);
    },
    listNotifications: async () => {
      const items = notifs.filter((n) => n.to === notifyKey()).map(({ to: _to, ...n }) => n);
      return { items, unread: items.filter((n) => n.unread).length };
    },
    markRead: async (id) => {
      for (const n of notifs) if (n.to === notifyKey() && (!id || n.id === id)) n.unread = false;
    },
    getProfile: async (orgId) => {
      const id = isHost(me) ? (orgId ?? me.orgId) : me.orgId;
      const o =
        id === HOST_ORG.id
          ? { id, name: HOST_ORG.name, labels: [], cats: [] }
          : (PARTNERS.find((p) => p.id === id) as PartnerOrg);
      const mine = posts.filter((p) => p.authorOrgId === id);
      return {
        org: {
          ...o,
          isHost: id === HOST_ORG.id,
          blurb: id === HOST_ORG.id ? "Trung gian chữ ký số, hoá đơn điện tử, vật tư đóng gói" : "",
        },
        stats: {
          active: mine.filter((p) => p.status === "active").length,
          archived: mine.filter((p) => p.status !== "active").length,
          comments: comments.filter((c) => mine.some((p) => p.id === c.postId)).length,
          ...(id === HOST_ORG.id ? { friends: PARTNERS.length } : {}),
        },
        ...(isHost(me) && id === HOST_ORG.id ? { shtUrl: "/contracts" } : {}),
      };
    },
    getSettings: async () => settings.get(me.userId) ?? structuredClone(DEFAULT_SETTINGS),
    saveSettings: async (s) => {
      settings.set(me.userId, s);
      return s;
    },
    chatAsk: async (): Promise<ChatReply> => ({ text: "Trợ lý giá sắp có." }),
  };

  return {
    api,
    setPersona: (id) => {
      me = PERSONAS.find((p) => p.id === id) ?? me;
    },
  };
}
