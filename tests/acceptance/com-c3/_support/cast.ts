// CR-102 · com-c3 · bộ nhân vật hien-thi.md (A, M, S1a/S1b, S2, B1, B2, X1 + công ty đã rời) trong tenant chủ quản + tenant khác.
// Dựng bằng owner (bỏ RLS), số câu cố định. Dùng chung cho int RLS (hien-thi) và int route.
import { enablePack, members, tenants, users } from "@ai/test-kit/builders";
import type { Sql } from "@ai/test-kit/db";

export type Cast = {
  A: string;
  B: string;
  /** user */
  hA: string;
  hM: string;
  hB: string;
  s1a: string;
  s1b: string;
  s2: string;
  b1: string;
  b2: string;
  x1: string;
  gone: string;
  off: string;
  /** công ty đối tác (admin.external_orgs) */
  S1: string;
  S2: string;
  B1: string;
  B2: string;
  X: string;
  LEFT: string;
  /** group vai gói của tenant A */
  roles: { owner: string; editor: string; viewer: string };
};

const orgId = (n: number) => `7e5d00c1-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const extUser = (n: number) => `7e5d00c2-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** `base` tách dải id giữa các file test (mỗi file DB riêng, nhưng giữ thói quen). */
export async function seedCast(sql: Sql, base: number): Promise<Cast> {
  const [A, B] = (await tenants(sql, 2, base)) as [string, string];
  const [hA] = (await users(sql, A, 1, { from: base, role: "tenant_admin" })) as [string];
  const [hM] = (await users(sql, A, 1, { from: base + 1 })) as [string];
  const [hB] = (await users(sql, B, 1, { from: base + 2 })) as [string];
  const o = [1, 2, 3, 4, 5, 6].map((i) => orgId(base * 10 + i));
  const [S1, S2, B1, B2, X, LEFT] = o as [string, string, string, string, string, string];
  await sql`insert into admin.external_orgs (id, tenant_id, name, active)
    select x.id, ${A}::uuid, x.name, x.active from jsonb_to_recordset(${sql.json([
      { id: S1, name: "Cơ sở Tân Phát", active: true },
      { id: S2, name: "Hãng NCCA", active: true },
      { id: B1, name: "Công ty Bao Bì Một", active: true },
      { id: B2, name: "Công ty Số Hai", active: true },
      { id: X, name: "Công ty Hai Chiều", active: true },
      { id: LEFT, name: "Công ty Đã Rời", active: false },
    ])}) as x(id uuid, name text, active boolean)`;
  const u = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => extUser(base * 10 + i));
  const [s1a, s1b, s2, b1, b2, x1, gone, off] = u as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const ext = [
    { id: s1a, org: S1, n: "S1a", active: true },
    { id: s1b, org: S1, n: "S1b", active: true },
    { id: s2, org: S2, n: "S2", active: true },
    { id: b1, org: B1, n: "B1", active: true },
    { id: b2, org: B2, n: "B2", active: true },
    { id: x1, org: X, n: "X1", active: true },
    { id: gone, org: LEFT, n: "Gone", active: true },
    { id: off, org: S1, n: "Off", active: false },
  ];
  await sql`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role, kind,
      external_org_id, active, deactivated_at)
    select x.id, ${A}::uuid, 'x' || ${base}::text || lower(x.n), lower(x.n) || ${base}::text || '@ext.test', 'kit-placeholder-hash',
      'Đối tác ' || x.n, 'member', 'external', x.org, x.active, case when x.active then null else now() end
    from jsonb_to_recordset(${sql.json(ext)}) as x(id uuid, org uuid, n text, active boolean)`;
  const roles = (await enablePack(sql, [A, B], "community")).get(A) as Cast["roles"];
  await members(sql, A, roles.owner, [hA]);
  await members(sql, A, roles.editor, [hM]);
  await sql`insert into community.partner_companies (tenant_id, ext_org_id, labels, cats)
    select ${A}::uuid, x.org, x.labels, x.cats from jsonb_to_recordset(${sql.json([
      { org: S1, labels: ["supplier"], cats: ["dong-goi"] },
      { org: S2, labels: ["supplier"], cats: ["chu-ky-so"] },
      { org: B1, labels: ["buyer"], cats: ["dong-goi"] },
      { org: B2, labels: ["buyer"], cats: ["chu-ky-so"] },
      { org: X, labels: ["supplier", "buyer"], cats: ["dong-goi"] },
      { org: LEFT, labels: ["buyer"], cats: ["dong-goi"] },
    ])}) as x(org uuid, labels text[], cats text[])`;
  return { A, B, hA, hM, hB, s1a, s1b, s2, b1, b2, x1, gone, off, S1, S2, B1, B2, X, LEFT, roles };
}

export type PostSeed = {
  key: string;
  type: "sell" | "buy" | "note";
  org: string | null;
  author: string;
  aud?: { mode: string; cats?: string[]; orgs?: string[] };
  cats?: string[];
  status?: "active" | "archived" | "done";
  hidden?: boolean;
  expired?: boolean;
  edited?: boolean;
  body?: string;
};

/** Chèn bài theo tập (1 câu). Trả `key -> id`. Nội dung đối tác: raw = masked = body (test che liên hệ đi qua route). */
export async function seedPosts(
  sql: Sql,
  tenant: string,
  rows: readonly PostSeed[],
): Promise<Map<string, string>> {
  const got = await sql<{ key: string; id: string }[]>`
    insert into community.posts (tenant_id, type, author_user_id, author_name, author_org, status, hidden, edited,
      title_raw, title_masked, body_raw, body_masked, fields_raw, fields_masked, cats, aud_mode, aud_cats, aud_orgs, expires_at)
    select ${tenant}::uuid, x.type, x.author, 'Người đăng', x.org, coalesce(x.status, 'active'), coalesce(x.hidden, false),
      coalesce(x.edited, false), x.key, x.key, coalesce(x.body, ''), coalesce(x.body, ''),
      jsonb_build_object('product', x.key, 'qty', '1'), jsonb_build_object('product', x.key, 'qty', '1'),
      coalesce(x.cats, '{}'), x.aud_mode, coalesce(x.aud_cats, '{}'), coalesce(x.aud_orgs, '{}'),
      case when x.expired then now() - interval '1 day' else now() + interval '30 days' end
    from jsonb_to_recordset(${sql.json(
      rows.map((r) => ({
        ...r,
        aud_mode: r.org === null ? (r.aud?.mode ?? "all") : null,
        aud_cats: r.aud?.cats ?? [],
        aud_orgs: r.aud?.orgs ?? [],
        expired: r.expired ?? false,
      })),
    )}) as x(key text, type text, author uuid, org uuid, status text, hidden boolean, edited boolean, body text,
      cats text[], aud_mode text, aud_cats text[], aud_orgs uuid[], expired boolean)
    returning title_raw as key, id::text as id`;
  return new Map(got.map((r) => [r.key, r.id]));
}

export type CommentSeed = {
  key: string;
  post: string;
  thread: string;
  author: string;
  org: string | null;
  hidden?: boolean;
};

/** Luồng (upsert) + bình luận theo tập (2 câu). Trả `key -> id` bình luận. */
export async function seedComments(
  sql: Sql,
  tenant: string,
  rows: readonly CommentSeed[],
): Promise<Map<string, string>> {
  const data = sql.json(rows.map((r) => ({ ...r, hidden: r.hidden ?? false })));
  await sql`insert into community.threads (tenant_id, post_id, ext_org_id)
    select distinct ${tenant}::uuid, x.post, x.thread from jsonb_to_recordset(${data}) as x(post uuid, thread uuid)
    on conflict (post_id, ext_org_id) do nothing`;
  const got = await sql<{ key: string; id: string }[]>`
    insert into community.comments (tenant_id, post_id, thread_id, thread_org, author_user_id, author_name, author_org,
      text_raw, text_masked, hidden)
    select ${tenant}::uuid, x.post, t.id, x.thread, x.author, 'Người viết', x.org, x.key, x.key, x.hidden
    from jsonb_to_recordset(${data}) as x(key text, post uuid, thread uuid, author uuid, org uuid, hidden boolean)
    join community.threads t on t.post_id = x.post and t.ext_org_id = x.thread
    returning text_raw as key, id::text as id`;
  return new Map(got.map((r) => [r.key, r.id]));
}
