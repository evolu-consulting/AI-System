// CR-191 · lát cr191-cross-comment · G1: luật «Ai thấy bài» cho công ty kết nối nằm ở HAI hàm DEFINER — `community.feed_connected` (0026, bảng tin)
// và `community.cross_post_tenant` (0032, hàng rào bình luận chéo; gọi qua `cross_comments`). Không gộp vì `feed_connected` cần LATERAL theo
// công ty trên `posts_feed_idx` (perf). Test này chạy bảng chân trị `audience-truth.ts` + các trạng thái bài qua CẢ HAI đường: phải khớp nhau.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, inPackAs, openOwner, type Sql } from "@ai/test-kit/db";
import { IDS, TRUTH } from "../../../../../../../tests/acceptance/com-c3/_support/audience-truth";

const P = tenantId(1931); // công ty đăng
const { T1, T2 } = IDS;
const POSTER = userId(1931);
const VIEWER = userId(1932);
const MST: Record<string, string> = { [T1]: "0100000931", [T2]: "0100000932-001" };
let o: Sql;
const posts: { key: string; id: string; want?: boolean }[] = [];

const mk = async (
  key: string,
  m: {
    aud?: string;
    tenants?: string[];
    orgs?: string[];
    type?: string;
    status?: string;
    hidden?: boolean;
    moderation?: string;
    expired?: boolean;
  },
) => {
  const exp = new Date(Date.now() + (m.expired ? -3_600_000 : 86_400_000));
  const r = await o<{ id: string }[]>`insert into community.posts
    (tenant_id, type, author_user_id, author_name, status, hidden, moderation, title_raw, title_masked, body_raw, body_masked,
     fields_raw, fields_masked, hits, cats, aud_mode, aud_orgs, aud_tenants, expires_at)
    values (${P}, ${m.type ?? "sell"}, ${POSTER}, 'Poster', ${m.status ?? "active"}, ${m.hidden ?? false}, ${m.moderation ?? "none"},
      ${key}, ${key}, 'b', 'b', ${o.json({})}, ${o.json({})}, ${o.json([])}, ${o.array(["dong-goi"])}, ${m.aud ?? "all"},
      ${o.array(m.orgs ?? [])}::uuid[], ${o.array(m.tenants ?? [])}::uuid[], ${exp})
    returning id`;
  return r[0]?.id as string;
};
const roles = async (viewer: string, rs: string[]) => {
  const key = `tax:${(MST[viewer] as string).replace(/[^0-9]/g, "")}`;
  await o`delete from contracts.partner_roles where tenant_id = ${P} and party_key = ${key}`;
  for (const r of rs)
    await o`insert into contracts.partner_roles (tenant_id, party_key, role, name) values (${P}, ${key}, ${r}, 'x')`;
};
/** Bài người xem thấy theo bảng tin (feed_connected) và theo hàng rào bình luận (cross_comments.post). */
const both = (viewer: string) =>
  inPackAs("community", viewer, VIEWER, async (tx) => {
    const feed = await tx<
      { id: string }[]
    >`select id::text from community.feed_connected(null, null, 101, null, ${P}::uuid)`;
    const fence = await tx<
      { id: string }[]
    >`select x.id from jsonb_to_recordset(${tx.json(posts.map((p) => ({ id: p.id })))}::jsonb) x(id text)
      where (community.cross_comments(x.id::uuid, null, null, 1, false, null) ->> 'post')::boolean`;
    return { feed: new Set(feed.map((r) => r.id)), fence: new Set(fence.map((r) => r.id)) };
  });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  for (const [id, mst] of [
    [P, "0100000930"],
    [T1, MST[T1] as string],
    [T2, MST[T2] as string],
  ] as const)
    await o`insert into admin.tenants (id, key, name, legal_name, tax_code)
      values (${id}, ${`xt-${id.slice(-6)}`}, ${`xt-${id.slice(-6)}`}, ${`Cty ${id.slice(-4)}`}, ${mst}) on conflict (id) do nothing`;
  await o`update admin.tenants set directory_verified_at = now(), directory_verified_by = ${POSTER} where id = any(${o.array([T1, T2])}::uuid[])`;
  for (const t of [T1, T2])
    await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at) values (${P}, ${t}, now()), (${t}, ${P}, now())`;
  await o`insert into admin.feature_entitlements (feature_id, tenant_id)
    select f.id, ${P}::uuid from admin.features f where f.key = 'contracts-community'
    on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  const specs = new Map<string, (typeof TRUTH)[number]>();
  for (const r of TRUTH) specs.set(r.name.split(" × ")[0] as string, r);
  for (const [name, r] of specs)
    posts.push({
      key: `truth:${name}`,
      id: await mk(`truth:${name}`, {
        aud: r.aud.mode,
        tenants: r.aud.tenants,
        orgs: r.aud.companies,
        type: r.type,
      }),
    });
  for (const [key, m] of [
    ["archived", { status: "archived" }],
    ["hidden", { hidden: true }],
    ["expired", { expired: true }],
    ["pending", { moderation: "pending" }],
    ["rejected", { moderation: "rejected" }],
  ] as const)
    posts.push({ key, id: await mk(key, m) });
}, 60_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-191 · G1 «Ai thấy bài»: bảng tin và hàng rào bình luận chéo khớp nhau", () => {
  it("bảng chân trị + trạng thái bài: feed_connected và cross_comments cho cùng tập bài, đúng bảng chân trị", async () => {
    const rows = TRUTH.filter((r) => r.viewer.kind === "connected");
    const byViewer = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.name.split(" × ")[1] as string;
      byViewer.set(k, [...(byViewer.get(k) ?? []), r]);
    }
    expect(byViewer.size).toBe(5);
    for (const [, list] of byViewer) {
      const v = list[0]?.viewer as { kind: "connected"; tenantId: string; labels: string[] };
      await roles(v.tenantId, v.labels);
      const { feed, fence } = await both(v.tenantId);
      expect([...fence].sort()).toEqual([...feed].sort());
      const idOf = new Map(posts.map((p) => [p.key, p.id]));
      for (const r of list)
        expect([r.name, fence.has(idOf.get(`truth:${r.name.split(" × ")[0]}`) as string)]).toEqual([
          r.name,
          r.want,
        ]);
      for (const k of ["archived", "hidden", "expired", "pending", "rejected"])
        expect([k, fence.has(idOf.get(k) as string)]).toEqual([k, false]);
    }
  });
});
