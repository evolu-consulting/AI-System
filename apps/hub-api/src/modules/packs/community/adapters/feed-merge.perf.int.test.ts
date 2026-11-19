// CR-191 · lát cr191-feed-merge-rls · N7 · đo bảng tin GỘP trên DB thật (role `community_rw`, RLS): người xem ở A, A có 2.000 bài, 200 công ty
// đã kết nối × 50 bài (10.000 bài, trộn «Ai thấy bài»). (1) số câu SQL repo mỗi trang CỐ ĐỊNH = 2 (bài mình + bài kết nối, đếm ở `tx.execute`);
// (2) p95 trang 20 bài (trang đầu + trang theo con trỏ). In số thật ra console.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/public";
import { mergeNewest } from "../domain/feed-merge.rules";
import type { Access } from "./community-access";
import { feed } from "./post.service";
import type { FeedFilter } from "./post.sql";

const A = tenantId(1690);
const VY = userId(1690);
const POSTER = userId(1691);
const PARTNERS = 200;
const PER = 50;
const OWN = 2_000;
const RUNS = 40;

let o: Sql;
let db: Db;
let statements = 0;
const counting = (tx: Tx): Tx =>
  new Proxy(tx, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (k !== "execute") return v;
      return (...a: unknown[]) => {
        statements++;
        return (v as (...x: unknown[]) => unknown).apply(t, a);
      };
    },
  });

const access = {
  who: { tenantId: A, userId: VY, userKind: "internal" },
  org: null,
  canWrite: true,
  joinAdmin: false,
  dir: { tenantName: "A", userName: "Vy", orgs: [] },
} as unknown as Access;
const base: FeedFilter = {
  org: null,
  tab: "all",
  cat: null,
  area: null,
  author: null,
  authorUser: null,
  source: null,
  q: null,
  mine: false,
  cursor: null,
  limit: 20,
};

async function measure(name: string, fn: () => Promise<unknown>) {
  await fn();
  const ms: number[] = [];
  statements = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  const p95 = ms[Math.ceil(RUNS * 0.95) - 1] ?? 0;
  const per = statements / RUNS;
  console.log(`[perf CR-191] ${name}: p95 ${p95.toFixed(1)} ms · ${per} câu SQL repo / trang`);
  return { p95, sql: per };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`create table pf_t as select gen_random_uuid() as id, i from generate_series(1, ${PARTNERS}) i`;
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code)
    select ${A}::uuid, 'fm-a', 'A', 'A', '0100000690'
    union all select id, 'fm-' || i, 'P' || i, 'Công ty ' || i, '8' || lpad(i::text, 9, '0') from pf_t`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at)
    select ${A}, id, now() from pf_t union all select id, ${A}, now() from pf_t`;
  await o`insert into admin.feature_entitlements (feature_id, tenant_id)
    select f.id, t.id from admin.features f, (select id from pf_t union all select ${A}::uuid) t where f.key = 'contracts-community'
    on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  await o`insert into community.posts (tenant_id, type, author_user_id, author_name, author_org, status, hidden, title_raw, title_masked,
      body_raw, body_masked, fields_raw, fields_masked, hits, cats, aud_mode, aud_tenants, created_at, expires_at)
    select t.id, 'sell', ${POSTER}, 'Người đăng', null, 'active', false, 'raw', 'bài ' || t.i || '-' || g, 'nd', 'nd', '{}'::jsonb, '{}'::jsonb,
      '[]'::jsonb, array['dong-goi'], (array['all', 'suppliers', 'internal', 'companies'])[1 + g % 4],
      case when g % 4 = 3 then array[${A}::uuid] else '{}'::uuid[] end,
      now() - ((g - 1) * ${PARTNERS} + t.i) * interval '1 second', now() + interval '30 days'
    from pf_t t, generate_series(1, ${PER}) g`;
  await o`insert into community.posts (tenant_id, type, author_user_id, author_name, author_org, status, hidden, title_raw, title_masked,
      body_raw, body_masked, fields_raw, fields_masked, hits, cats, aud_mode, created_at, expires_at)
    select ${A}, 'note', ${POSTER}, 'Người đăng', null, 'active', false, 'raw', 'mình ' || g, 'nd', 'nd', '{}'::jsonb, '{}'::jsonb,
      '[]'::jsonb, array['dong-goi'], 'all', now() - g * interval '40 second', now() + interval '30 days'
    from generate_series(1, ${OWN}) g`;
  for (const t of [
    "admin.tenants",
    "hub.partner_links",
    "community.posts",
    "admin.feature_entitlements",
  ])
    await o.unsafe(`analyze ${t}`);
  await users(o, A, 1, { from: 1690 });
  db = createDb(urls().hubApi, { max: 4 });
}, 600_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-191 · perf bảng tin gộp (N7)", () => {
  it("trang 20 bài (2.000 bài mình + 10.000 bài của 200 công ty kết nối): 2 câu SQL cố định, p95 ≤ 120 ms", async () => {
    const uow = createPackUow(db, "community", (tx) => ({ tx: counting(tx) }));
    const page = async (cursor: FeedFilter["cursor"]) => {
      const out = await feed(uow as never, access, { ...base, cursor });
      return mergeNewest(out.own.items, out.connected, 20);
    };
    const p1 = await page(null);
    expect(p1.items).toHaveLength(20);
    expect(p1.more).toBe(true);
    expect(new Set(p1.items.map((x) => x.src))).toEqual(new Set(["own", "connected"]));
    const last = p1.items.at(-1)?.row as { created_at: string; id: string };
    const cur = { at: last.created_at, id: last.id };
    const r1 = await measure("GET /feed gộp trang đầu (20)", () => page(null));
    const r2 = await measure("GET /feed gộp trang sau (20)", () => page(cur));
    // tách phần: chỉ bài công ty mình (lọc «chủ quản» ⇒ không gọi hàm kết nối) để biết phần thêm của nguồn kết nối
    const r0 = await measure("GET /feed chỉ công ty mình (20)", async () =>
      feed(uow as never, access, { ...base, author: "host" }),
    );
    expect([r0.sql, r1.sql, r2.sql]).toEqual([1, 2, 2]);
    expect(r1.p95).toBeLessThanOrEqual(120);
    expect(r2.p95).toBeLessThanOrEqual(120);
  });
});
