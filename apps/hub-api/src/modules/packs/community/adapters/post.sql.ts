// CR-102 · com-c3 · Luật 4c: câu đọc bài. Bảng tin = MỘT câu (trang + đếm theo tab + facets); RLS `community_rw` lọc người xem,
// Cột raw/hits/audience chỉ khi DB nói người xem là chủ quản (`packs.viewer_ext_org() is null`, không theo token — review TB1). Văn bản SQL cố định; mọi lọc là tham số.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

export type PostRow = {
  id: string;
  type: "sell" | "buy" | "note";
  author_org: string | null;
  author_user_id: string;
  author_name: string;
  status: "active" | "archived" | "done" | "expired";
  hidden: boolean;
  edited: boolean;
  created_at: string;
  expires_at: string;
  title: string;
  body: string;
  fields: Record<string, string | null>;
  hits: unknown[] | null;
  cats: string[];
  aud: { mode: string; cats: string[]; companies: string[] } | null;
  media: { id: string; kind: "image" | "video"; label: string; url: string | null }[];
  comments: number;
  /** Chỉ chủ quản (host=true): dấu đã lưu báo giá + khoá đối tác SHT của bên đăng; đối tác: null. */
  quotes: QuoteMarkRow[] | null;
  party_key: string | null;
};

export type QuoteMarkRow = {
  item_idx: number;
  comment_id: string | null;
  by: string;
  at: string;
  product_id: string;
  supplier: string;
  price: number;
  unit: string | null;
  edited: boolean;
  price_edited: boolean;
};

export type FeedFilter = {
  /** Tổ chức người xem (null = chủ quản) — cho `mine`. */
  org: string | null;
  tab: "all" | "sell" | "buy" | "note" | "archived";
  cat: string | null;
  area: string | null;
  /** "host" = bài chủ quản; uuid = công ty; null = mọi người đăng. */
  author: string | null;
  q: string | null;
  mine: boolean;
  cursor: { at: string; id: string } | null;
  limit: number;
};

export type FeedRaw = {
  items: PostRow[];
  counts: { all: number; sell: number; buy: number; note: number; archived: number };
  facets: { cats: string[]; areas: string[] };
};

/** Cột hiển thị theo người xem (alias bảng `p`). */
const shown: SQL = sql`
  case when p.status = 'active' and p.expires_at <= now() then 'expired' else p.status end as eff,
  case when (select packs.viewer_ext_org()) is null then p.title_raw else p.title_masked end as t_title,
  case when (select packs.viewer_ext_org()) is null then p.body_raw else p.body_masked end as t_body,
  case when (select packs.viewer_ext_org()) is null then p.fields_raw else p.fields_masked end as t_fields`;

/** JSON một bài (alias `v` trên hàng đã có cột `shown`). */
const itemJson: SQL = sql`json_build_object(
  'id', v.id, 'type', v.type, 'author_org', v.author_org, 'author_user_id', v.author_user_id,
  'author_name', v.author_name, 'status', v.eff, 'hidden', v.hidden, 'edited', v.edited,
  'created_at', v.created_at, 'expires_at', v.expires_at, 'title', v.t_title, 'body', v.t_body, 'fields', v.t_fields,
  'hits', case when (select packs.viewer_ext_org()) is null then v.hits end, 'cats', v.cats,
  'aud', case when (select packs.viewer_ext_org()) is null and v.author_org is null
    then json_build_object('mode', v.aud_mode, 'cats', v.aud_cats, 'companies', v.aud_orgs) end,
  'media', coalesce((select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'label', m.label, 'url', m.url)
    order by m.position) from community.media m where m.post_id = v.id), '[]'::json),
  'comments', (select count(*)::int from community.comments c where c.post_id = v.id),
  'quotes', case when (select packs.viewer_ext_org()) is null then (select json_agg(json_build_object('item_idx', q.item_idx,
    'comment_id', q.comment_id, 'by', q.saved_by_name, 'at', q.saved_at, 'product_id', q.product_id,
    'supplier', q.supplier_name, 'price', q.price, 'unit', q.unit, 'edited', coalesce(v.edited_at > q.saved_at, false),
    'price_edited', coalesce(v.price_edited_at > q.saved_at, false)) order by q.saved_at)
    from community.quote_saves q where q.post_id = v.id) end,
  'party_key', case when (select packs.viewer_ext_org()) is null and v.author_org is not null then (select pc.party_key
    from community.partner_companies pc where pc.tenant_id = v.tenant_id and pc.ext_org_id = v.author_org) end)`;

/** `GET /feed`: một câu. Tab "all" = đang hiệu lực (mọi loại); "archived" = lưu trữ/đã xong/hết hạn. */
export async function feedQuery(tx: Tx, tenantId: string, f: FeedFilter): Promise<FeedRaw> {
  const q = f.q === null ? null : `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await tx.execute<{ r: FeedRaw }>(sql`
    with vis as (
      select p.*, ${shown} from community.posts p where p.tenant_id = ${tenantId}::uuid
    ), base as (
      select * from vis v
      where (not ${f.mine}::boolean or v.author_org is not distinct from ${f.org}::uuid)
        and (${f.cat}::text is null or ${f.cat}::text = any (v.cats))
        and (${f.area}::text is null or lower(v.t_fields ->> 'area') = lower(${f.area}::text))
        and (${f.author}::text is null or (${f.author}::text = 'host' and v.author_org is null)
          or v.author_org::text = ${f.author}::text)
        and (${q}::text is null or (v.t_title || ' ' || coalesce(v.t_fields ->> 'product', '') || ' ' || v.t_body)
          ilike ${q}::text)
    ), page as (
      select * from base v
      where case ${f.tab}::text when 'all' then v.eff = 'active' when 'archived' then v.eff <> 'active'
          else v.eff = 'active' and v.type = ${f.tab}::text end
        and (${f.cursor?.at ?? null}::timestamptz is null
          or (v.created_at, v.id) < (${f.cursor?.at ?? null}::timestamptz, ${f.cursor?.id ?? null}::uuid))
      order by v.created_at desc, v.id desc
      limit ${f.limit + 1}::int
    )
    select json_build_object(
      'items', coalesce((select json_agg(${itemJson} order by v.created_at desc, v.id desc) from page v), '[]'::json),
      'counts', (select json_build_object(
          'all', count(*) filter (where eff = 'active'),
          'sell', count(*) filter (where eff = 'active' and type = 'sell'),
          'buy', count(*) filter (where eff = 'active' and type = 'buy'),
          'note', count(*) filter (where eff = 'active' and type = 'note'),
          'archived', count(*) filter (where eff <> 'active')) from base),
      'facets', json_build_object(
        'cats', coalesce((select json_agg(distinct c order by c) from vis, unnest(vis.cats) c), '[]'::json),
        'areas', coalesce((select json_agg(distinct a order by a) from (select nullif(btrim(t_fields ->> 'area'), '') a
          from vis) x where a is not null), '[]'::json))) as r`);
  return rows[0]?.r as FeedRaw;
}

/** Một bài theo id dưới RLS người xem (vắng ⇒ null = 404). */
export async function postById(tx: Tx, id: string): Promise<PostRow | null> {
  const rows = await tx.execute<{ r: PostRow }>(sql`
    select ${itemJson} as r from (select p.*, ${shown} from community.posts p where p.id = ${id}::uuid) v`);
  return rows[0]?.r ?? null;
}
