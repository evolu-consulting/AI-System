// CR-102 · com-c3 · hàng SQL → contract `@ai/contracts/community`. Một chỗ quyết trường theo người xem: user ngoài KHÔNG BAO GIỜ
// nhận `hidden`/`hits`/`audience`/`authorLeft`/`saveQuote` (HT-52, HT-64); `expiresAt` chỉ cho chủ quản + bên đăng.
import type {
  CommentView,
  ContentHit,
  HostHint,
  PartnerOrg,
  PostAudience,
  PostView,
  QuoteMark,
} from "@ai/contracts/community";
import { postActions } from "../domain/audience.rules";
import type { CommentRow } from "./comment-list.repo";
import type { Access } from "./community-access";
import type { ConnectedRow } from "./feed-connected.sql";
import type { PartnerRow } from "./org.repo";
import type { PostRow, QuoteMarkRow } from "./post.sql";

const iso = (s: string): string => new Date(s).toISOString();

export type Names = {
  orgName: (org: string | null) => string;
  orgLeft: (org: string | null) => boolean;
};

export function namesOf(a: Access): Names {
  const by = new Map(a.dir.orgs.map((o) => [o.id, o]));
  return {
    orgName: (org) => (org === null ? a.dir.tenantName : (by.get(org)?.name ?? "")),
    orgLeft: (org) => org !== null && by.get(org)?.active === false,
  };
}

/** Id công ty hiển thị: chủ quản = id tenant. */
export const orgIdOf = (a: Access, org: string | null): string => org ?? a.who.tenantId;

const mediaView = (m: PostRow["media"][number]) => ({
  id: m.id,
  kind: m.kind,
  label: m.label,
  ...(m.url ? { url: m.url } : {}),
  ...(m.file_id
    ? { fileId: m.file_id, name: m.name ?? "", size: Number(m.size ?? 0), mime: m.mime ?? "" }
    : {}),
});

/** `hint` (gợi ý SHT, C8) chỉ được gắn khi người xem là chủ quản; `quotes` (C7b) cũng chỉ chủ quản — HT-64, HT-68. */
export function postView(a: Access, n: Names, r: PostRow, hint?: HostHint): PostView {
  const host = a.org === null;
  const own = r.author_org === a.org;
  const base: PostView = {
    id: r.id,
    type: r.type,
    authorOrgId: orgIdOf(a, r.author_org),
    authorOrgName: n.orgName(r.author_org),
    authorName: r.author_name,
    ...(host ? { authorUserId: r.author_user_id } : {}),
    authorSide: r.author_org === null ? "host" : "partner",
    ...(r.author_title ? { authorTitle: r.author_title } : {}),
    source: "own",
    createdAt: iso(r.created_at),
    ...(host || own ? { expiresAt: iso(r.expires_at) } : {}),
    edited: r.edited,
    status: r.status,
    title: r.title,
    body: r.body,
    fields: r.fields,
    cats: r.cats,
    media: r.media.map(mediaView),
    commentCount: r.comments,
    // CR-147c: DB trả mới → cũ; hiển thị cũ → mới
    recentComments: [...(r.recent ?? [])].reverse().map((x) => commentView(a, n, x)),
    ...(r.mentions?.length
      ? { mentionedUsers: r.mentions.map((m) => ({ userId: m.user_id, name: m.name })) }
      : {}),
    actions: postActions(
      { type: r.type, authorOrg: r.author_org, status: r.status, hidden: r.hidden },
      { org: a.org },
    ).filter((x) => x !== "edit" || host || r.author_user_id === a.who.userId), // review Thấp2: đối tác chỉ người đăng sửa
  };
  if (!host) return base;
  const hits = (r.hits ?? []) as ContentHit[];
  return {
    ...base,
    hidden: r.hidden,
    ...(n.orgLeft(r.author_org) ? { authorLeft: true } : {}),
    ...(hits.length ? { hits } : {}),
    ...(r.aud ? { audience: r.aud as PostAudience } : {}),
    ...(r.quotes?.length ? { quotes: r.quotes.map(markView) } : {}),
    ...(hint ? { hostHint: hint } : {}),
  };
}

/** CR-191 · bài của công ty ĐÃ KẾT NỐI (bản đã che): không thao tác bài, không tệp tải về (chỉ số tệp); bình luận chéo (BR-191-12):
 * số + 3 mới nhất người xem thấy (DEFINER). Không bao giờ có `hidden`/`hits`/`audience`/`quotes`/`hostHint`/`expiresAt`. */
export function connectedView(r: ConnectedRow, ctx?: { a: Access; n: Names }): PostView {
  return {
    id: r.id,
    type: r.type,
    authorOrgId: r.tenant_id,
    authorOrgName: r.company_name,
    authorName: r.author_name,
    authorUserId: r.author_user_id,
    authorSide: "partner",
    ...(r.author_title ? { authorTitle: r.author_title } : {}),
    source: "connected",
    createdAt: iso(r.created_at),
    edited: r.edited,
    status: "active",
    title: r.title,
    body: r.body,
    fields: r.fields,
    cats: r.cats,
    media: [],
    fileCount: r.file_count,
    commentCount: r.comment_count ?? 0,
    // DB trả mới → cũ; hiển thị cũ → mới
    recentComments: ctx
      ? [...(r.recent ?? [])].reverse().map((x) => commentView(ctx.a, ctx.n, x))
      : [],
    actions: [],
  };
}

/** CR-191 · bên người viết: bình luận chéo công ty ⇒ công ty (tenant) người viết thay cho bên đối tác cộng đồng; cờ ẩn/xoá được. */
function commentSide(a: Access, n: Names, r: CommentRow) {
  const host = a.org === null;
  const cross = host && !!r.author_tenant;
  const far = cross && r.author_tenant !== a.who.tenantId;
  const mod = host && !!r.post_author && (r.post_author === a.who.userId || a.joinAdmin);
  return {
    authorOrgId: cross ? (r.author_tenant as string) : orgIdOf(a, r.author_org),
    authorOrgName: cross ? (r.author_company ?? "") : n.orgName(r.author_org),
    authorSide: far || r.author_org !== null ? ("partner" as const) : ("host" as const),
    ...(far ? { fromConnected: true } : {}),
    ...(mod ? { moderate: true } : {}),
  };
}

export function commentView(a: Access, n: Names, r: CommentRow): CommentView {
  const host = a.org === null;
  const hits = (r.hits ?? []) as ContentHit[];
  const mineTenant = !r.author_tenant || r.author_tenant === a.who.tenantId;
  return {
    id: r.id,
    authorName: r.author_name,
    ...commentSide(a, n, r),
    text: r.text,
    ...(host && hits.length ? { hits } : {}),
    createdAt: iso(r.created_at),
    ...(host ? { hidden: r.hidden } : {}),
    mine: r.author_user_id === a.who.userId && mineTenant,
    // đối tác chỉ nhận phần tử là công ty MÌNH (không lộ đối tác khác được nhắc cùng — design §6.1)
    mentions: r.mentions
      .filter((m) => host || m === a.org)
      .map((m) => ({ orgId: m, name: n.orgName(m) })),
    ...(r.mention_people?.length
      ? { mentionedUsers: r.mention_people.map((m) => ({ userId: m.id, name: m.name })) }
      : {}),
  };
}

/** Công ty của một trang `?limit=&offset=&q=` (tên không phân biệt hoa thường); không `limit` ⇒ undefined = tất cả. */
export function pageOrgIds(
  a: Access,
  pg: { q?: string | undefined; limit?: number | undefined; offset: number },
): string[] | undefined {
  if (pg.limit === undefined) return undefined;
  const needle = pg.q?.toLowerCase();
  const seen = a.org === null ? a.dir.orgs : a.dir.orgs.filter((o) => o.id === a.org);
  const named = needle ? seen.filter((o) => o.name.toLowerCase().includes(needle)) : seen;
  return named.slice(pg.offset, pg.offset + pg.limit).map((o) => o.id);
}

/** Chủ quản: mọi công ty đối tác (bạn bè, kể cả đã rời) + nhãn; đối tác: chỉ công ty mình, không `left`/`partyKey`. */
export function partnerViews(
  a: Access,
  rows: readonly PartnerRow[],
  only?: readonly string[],
): PartnerOrg[] {
  const by = new Map(rows.map((r) => [r.ext_org_id, r]));
  const seen = a.org === null ? a.dir.orgs : a.dir.orgs.filter((o) => o.id === a.org);
  const orgs = only === undefined ? seen : only.flatMap((id) => seen.filter((o) => o.id === id));
  return orgs.map((o) => {
    const r = by.get(o.id);
    const v: PartnerOrg = { id: o.id, name: o.name, labels: r?.labels ?? [], cats: r?.cats ?? [] };
    if (r?.area) v.area = r.area;
    if (a.org === null) {
      if (!o.active) v.left = true;
      if (r?.party_key) v.partyKey = r.party_key;
    }
    return v;
  });
}

const markView = (q: QuoteMarkRow): QuoteMark => ({
  itemIdx: q.item_idx,
  ...(q.comment_id ? { commentId: q.comment_id } : {}),
  ...(q.comment_deleted ? { commentDeleted: true } : {}),
  by: q.by,
  at: iso(q.at),
  productId: q.product_id,
  supplier: q.supplier,
  price: Number(q.price),
  unit: q.unit,
  postEdited: q.edited,
  priceEdited: q.price_edited,
});
