// CR-161 · lát 6 · Luật 4c · spec §6 · đo đường nóng kết nối trên DB thật (role `contracts_rw`, RLS): 20.000 công ty trong Danh bạ, A có 2.000 dòng link (500 đã kết nối).
// CR-191: đo bài công ty đã kết nối chuyển sang `community/adapters/feed-merge.perf.int.test.ts` (bảng tin gộp). (1) số câu SQL của repo mỗi thao tác CỐ ĐỊNH (đếm ở `tx.execute`); (2) p95 theo ngưỡng spec. In số thật ra console.
// CR-169: phần trò chuyện đã gỡ — đo nay ở `messages/pmsg.perf.int.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { createDb, type Db } from "@ai/db";
import { enableAddon, enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow, packTenantOnly } from "../../kit/public";
import { connectRepo } from "./adapters/connect.repo";
import { connectUsecases } from "./application/connect.usecase";

const A = tenantId(1650);
const B = tenantId(1651);
const TIEN = userId(1650);
const DUNG = userId(1651);
const OTHERS = 20_000;
const LINKS = 2_000;
const CONNECTED = 500; // gồm B
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
const uow = () =>
  packTenantOnly(
    createPackUow(db, "contracts", (tx, t) => ({
      connect: connectRepo(counting(tx), t),
    })),
  );
const who = { tenantId: A, userId: TIEN };
const connect = () => connectUsecases({ uow: uow(), selfName: async () => "Tiên" });

async function measure(
  name: string,
  fn: () => Promise<unknown>,
): Promise<{ p95: number; sql: number }> {
  await fn(); // làm nóng kết nối/chuẩn bị câu
  const ms: number[] = [];
  statements = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    ms.push(performance.now() - t0);
  }
  const per = statements / RUNS;
  ms.sort((a, b) => a - b);
  const p95 = ms[Math.ceil(RUNS * 0.95) - 1] ?? 0;
  console.log(`[perf CR-161] ${name}: p95 ${p95.toFixed(1)} ms · ${per} câu SQL repo / thao tác`);
  return { p95, sql: per };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'pf-a', 'A', 'NitiGroup', '0100000401', true), (${B}, 'pf-b', 'B', 'Preschool Việt', '0100000402', true)`;
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    select gen_random_uuid(), 'pf-' || i, 'P' || i, 'Công ty Hàng ' || i, '9' || lpad(i::text, 9, '0'), true
    from generate_series(1, ${OTHERS}) i`;
  await users(o, A, 1, { from: 1650 });
  await users(o, B, 1, { from: 1651 });
  const grp = await enablePack(o, [A, B], "contracts");
  const g = (t: string) => grp.get(t) as Record<"owner" | "editor" | "viewer", string>;
  await members(o, A, g(A).owner, [TIEN]);
  await members(o, B, g(B).owner, [DUNG]);
  await enableAddon(o, [B], "contracts-community");
  // 2.000 dòng link của A: 500 đã kết nối hai chiều (gồm B), phần còn lại chỉ A mời.
  await o`create table pf_x as select id, row_number() over (order by key) as rn
    from admin.tenants where key like 'pf-%' and id not in (${A}, ${B}) order by key limit ${LINKS - 1}`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values (${A}, ${B}, now(), now()), (${B}, ${A}, now(), now())`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at, connect_requested_at)
    select ${A}, id, now() - rn * interval '1 minute', case when rn < ${CONNECTED} then now() end, case when rn >= ${CONNECTED} then now() end from pf_x`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) select id, ${A}, now(), now() from pf_x where rn < ${CONNECTED}`;
  for (const t of ["admin.tenants", "hub.partner_links"]) await o.unsafe(`analyze ${t}`);
  db = createDb(urls().hubApi, { max: 4 });
}, 600_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-161 · perf kết nối + bài công khai (spec §6)", () => {
  it("tìm công ty (20.000 công ty, 2.000 dòng link của A): 1 câu, p95 ≤ 25 ms", async () => {
    const byName = await connect().search(who, "Hàng 1999");
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.length).toBeLessThanOrEqual(20);
    const r = await measure("GET /connect/search (tên)", () => connect().search(who, "Hàng 1999"));
    expect(r.sql).toBe(1);
    expect(r.p95).toBeLessThanOrEqual(25);
    const t = await measure("GET /connect/search (MST)", () => connect().search(who, "9000001999"));
    expect(t.sql).toBe(1);
    expect(t.p95).toBeLessThanOrEqual(25);
  });

  it("danh sách kết nối (500 kết nối): 1 câu, p95 ≤ 30 ms", async () => {
    const page = await connect().links(who, { cursor: null, limit: 20 });
    expect(page.items).toHaveLength(20);
    const r = await measure("GET /connect/links (20)", () =>
      connect().links(who, { cursor: null, limit: 20 }),
    );
    expect(r.sql).toBe(1);
    expect(r.p95).toBeLessThanOrEqual(30);
  });
});
