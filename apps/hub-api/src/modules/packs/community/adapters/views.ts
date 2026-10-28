// CR-102 · com-c3 · hàng SQL → contract `@ai/contracts/community`. Một chỗ quyết trường theo người xem: user ngoài KHÔNG BAO GIỜ
// nhận `hidden`/`hits`/`audience`/`authorLeft`/`saveQuote` (HT-52, HT-64); `expiresAt` chỉ cho chủ quản + bên đăng.
import type {
  CommentView,
  ContentHit,
  PartnerOrg,
  PostAudience,
  PostView,
} from "@ai/contracts/community";
import { postActions } from "../domain/audience.rules";
import type { Access } from "./community-access";
import type { PartnerRow } from "./org.repo";
import type { PostRow } from "./post.sql";
import type { CommentRow } from "./thread.repo";

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

export function postView(a: Access, n: Names, r: PostRow): PostView {
  const host = a.org === null;
  const own = r.author_org === a.org;
  const base: PostView = {
    id: r.id,
    type: r.type,
    authorOrgId: orgIdOf(a, r.author_org),
    authorOrgName: n.orgName(r.author_org),
    authorName: r.author_name,
    authorSide: r.author_org === null ? "host" : "partner",
    createdAt: iso(r.created_at),
    ...(host || own ? { expiresAt: iso(r.expires_at) } : {}),
    edited: r.edited,
    status: r.status,
    title: r.title,
    body: r.body,
    fields: r.fields,
    cats: r.cats,
    media: r.media.map((m) => ({
      id: m.id,
      kind: m.kind,
      label: m.label,
      ...(m.url ? { url: m.url } : {}),
    })),
    commentCount: r.comments,
    actions: postActions(
      { type: r.type, authorOrg: r.author_org, status: r.status, hidden: r.hidden },
      { org: a.org },
    ),
  };
  if (!host) return base;
  const hits = (r.hits ?? []) as ContentHit[];
  return {
    ...base,
    hidden: r.hidden,
    ...(n.orgLeft(r.author_org) ? { authorLeft: true } : {}),
    ...(hits.length ? { hits } : {}),
    ...(r.aud ? { audience: r.aud as PostAudience } : {}),
  };
}

export function commentView(a: Access, n: Names, r: CommentRow): CommentView {
  const host = a.org === null;
  const hits = (r.hits ?? []) as ContentHit[];
  return {
    id: r.id,
    authorName: r.author_name,
    authorOrgId: orgIdOf(a, r.author_org),
    authorOrgName: n.orgName(r.author_org),
    authorSide: r.author_org === null ? "host" : "partner",
    text: r.text,
    ...(host && hits.length ? { hits } : {}),
    createdAt: iso(r.created_at),
    ...(host ? { hidden: r.hidden } : {}),
    mine: r.author_user_id === a.who.userId,
  };
}

/** Chủ quản: mọi công ty đối tác (bạn bè, kể cả đã rời) + nhãn; đối tác: chỉ công ty mình, không `left`/`partyKey`. */
export function partnerViews(a: Access, rows: readonly PartnerRow[]): PartnerOrg[] {
  const by = new Map(rows.map((r) => [r.ext_org_id, r]));
  const orgs = a.org === null ? a.dir.orgs : a.dir.orgs.filter((o) => o.id === a.org);
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
