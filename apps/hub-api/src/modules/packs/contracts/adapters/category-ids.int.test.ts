// HD-FR-07 · HD-NFR-01 · D-22 · HD1 plan §3/§6 (Luật 4c): `contracts.category_ids` giữ đúng bằng trigger MỨC CÂU LỆNH trên
// `contract_items` — ghi/sửa/xoá item (nhiều HĐ trong một câu, nhiều tenant), xoá loại (FK SET NULL), qua role `contracts_rw`
// có RLS (tenant khác không bị chạm), hai tx đồng thời trên cùng HĐ không mất cập nhật; đo chi phí ghi lô item có/không trigger.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  HUB_API_URL,
  ownerSql,
  prepareDb,
  type Sql,
  T,
} from "../../../../../../../tests/acceptance/H1/_fixtures";

let sql: Sql;
let hub: Sql;
const U = "0e0e0000-0000-4000-8000-000000000009";
const hc = (n: number) => `c0c00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cat = (n: number) => `ca700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sorted = (xs: string[]) => [...xs].sort();

/** HĐ 1…n ở tenant `tid` (một câu), loại 1…k. */
async function seed(tid: string, from: number, n: number, cats: number[]): Promise<void> {
  await sql`insert into contracts.contracts (id, tenant_id, title, created_by)
    select ('c0c00000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, ${tid}::uuid, 'HĐ ' || g, ${U}::uuid
    from generate_series(${from}::int, ${from + n - 1}::int) g`;
  await sql`insert into contracts.contract_categories (id, tenant_id, name)
    select ('ca700000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, ${tid}::uuid, 'Loại ' || g
    from unnest(${cats}::int[]) g`;
}
async function idsOf(id: string): Promise<string[]> {
  const [r] = await sql<
    { ids: string[] }[]
  >`select category_ids as ids from contracts.contracts where id = ${id}`;
  return r?.ids ?? [];
}
type Item = { c: number; tid: string; ord: number; cat: number | null };
/** Một câu INSERT cho cả lô (tham số JSON). */
async function addItems(q: Sql, items: Item[]): Promise<void> {
  const rows = items.map((x) => ({
    c: hc(x.c),
    t: x.tid,
    o: x.ord,
    k: x.cat === null ? null : cat(x.cat),
  }));
  await q`insert into contracts.contract_items (tenant_id, contract_id, ord, name, category_id)
    select (r->>'t')::uuid, (r->>'c')::uuid, (r->>'o')::smallint, 'Hàng', (r->>'k')::uuid
    from jsonb_array_elements(${JSON.stringify(rows)}::text::jsonb) r`;
}

async function xminOf(id: string): Promise<string | undefined> {
  const [r] = await sql<
    { x: string }[]
  >`select xmin::text as x from contracts.contracts where id = ${id}`;
  return r?.x;
}
/** Thời gian (ms) của `n` lần ghi lô trong tx rồi rollback (dữ liệu giữ nguyên giữa các lần). */
async function timeLot(lot: Item[], n: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++)
    await sql
      .begin(async (tx) => {
        const t0 = performance.now();
        await addItems(tx as unknown as Sql, lot);
        out.push(performance.now() - t0);
        throw new Error("rollback");
      })
      .catch(() => {});
  return out;
}

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  hub = postgres(HUB_API_URL, { max: 2, onnotice: () => {} });
  await sql`truncate contracts.contract_items, contracts.contract_categories, contracts.contracts cascade`;
  await seed(T.acme, 1, 4, [1, 2, 3]);
  await seed(T.beta, 101, 2, [101, 102]);
}, 60_000);
afterAll(async () => {
  await hub?.end();
  await sql?.end();
});

describe("HD-FR-07 · D-22 · category_ids gộp sẵn bằng trigger câu lệnh", () => {
  it("INSERT một câu cho nhiều HĐ, hai tenant: mảng loại khác nhau, sắp tăng; item không loại ⇒ {}", async () => {
    await addItems(sql, [
      { c: 1, tid: T.acme, ord: 0, cat: 2 },
      { c: 1, tid: T.acme, ord: 1, cat: 1 },
      { c: 1, tid: T.acme, ord: 2, cat: 2 },
      { c: 2, tid: T.acme, ord: 0, cat: 3 },
      { c: 3, tid: T.acme, ord: 0, cat: null },
      { c: 101, tid: T.beta, ord: 0, cat: 101 },
    ]);
    expect({
      c1: await idsOf(hc(1)),
      c2: await idsOf(hc(2)),
      c3: await idsOf(hc(3)),
      b: await idsOf(hc(101)),
    }).toEqual({
      c1: sorted([cat(1), cat(2)]),
      c2: [cat(3)],
      c3: [],
      b: [cat(101)],
    });
  });

  it("UPDATE đổi loại và chuyển item sang HĐ khác: cả HĐ cũ và mới đúng; sửa cột khác không ghi contracts", async () => {
    await sql`update contracts.contract_items set category_id = ${cat(3)} where contract_id = ${hc(1)} and ord = 1`;
    expect(await idsOf(hc(1))).toEqual(sorted([cat(2), cat(3)]));
    await sql`update contracts.contract_items set contract_id = ${hc(4)}, ord = 9 where contract_id = ${hc(2)} and ord = 0`;
    expect({ c2: await idsOf(hc(2)), c4: await idsOf(hc(4)) }).toEqual({ c2: [], c4: [cat(3)] });
    const x0 = await xminOf(hc(1));
    await sql`update contracts.contract_items set name = 'Đổi tên' where contract_id = ${hc(1)}`;
    expect(await xminOf(hc(1))).toBe(x0);
  });

  it("DELETE: bỏ loại không còn item nào, giữ loại còn item khác; xoá loại (FK SET NULL) ⇒ rút khỏi mảng", async () => {
    await sql`delete from contracts.contract_items where contract_id = ${hc(1)} and ord = 2`;
    expect(await idsOf(hc(1))).toEqual(sorted([cat(2), cat(3)]));
    await sql`delete from contracts.contract_items where contract_id = ${hc(1)} and ord = 0`;
    expect(await idsOf(hc(1))).toEqual([cat(3)]);
    await sql`delete from contracts.contract_categories where id = ${cat(3)}`;
    expect({ c1: await idsOf(hc(1)), c4: await idsOf(hc(4)) }).toEqual({ c1: [], c4: [] });
  });
});

describe("HD-FR-07 · D-22 · RLS và đồng thời", () => {
  it("qua contracts_rw + RLS (tenant acme): ghi đúng HĐ acme, HĐ tenant beta không bị chạm (xmin giữ nguyên)", async () => {
    const b0 = await xminOf(hc(101));
    await hub.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${T.acme}, true)`;
      await tx`set local role contracts_rw`;
      await addItems(tx as unknown as Sql, [
        { c: 3, tid: T.acme, ord: 5, cat: 1 },
        { c: 4, tid: T.acme, ord: 5, cat: 2 },
      ]);
      await tx`update contracts.contract_items set category_id = ${cat(2)} where contract_id = ${hc(3)} and ord = 5`;
    });
    expect({
      c3: await idsOf(hc(3)),
      c4: await idsOf(hc(4)),
      b: await idsOf(hc(101)),
      bx: await xminOf(hc(101)),
    }).toEqual({ c3: [cat(2)], c4: [cat(2)], b: [cat(101)], bx: b0 });
  });

  it("hai tx đồng thời thêm item khác loại vào cùng HĐ: không mất cập nhật", async () => {
    const a = postgres(HUB_API_URL.replace("hub_api:hub_api_dev_pw", "ai:ai_dev_pw"), { max: 1 });
    const b = postgres(HUB_API_URL.replace("hub_api:hub_api_dev_pw", "ai:ai_dev_pw"), { max: 1 });
    try {
      await a`begin`;
      await addItems(a, [{ c: 2, tid: T.acme, ord: 20, cat: 1 }]);
      const pb = b.begin((tx) =>
        addItems(tx as unknown as Sql, [{ c: 2, tid: T.acme, ord: 21, cat: 2 }]),
      );
      await a`commit`;
      await pb;
      expect(await idsOf(hc(2))).toEqual(sorted([cat(1), cat(2)]));
    } finally {
      await a.end();
      await b.end();
    }
  });
});

describe("HD-NFR-01 · D-22 · chi phí ghi", () => {
  it("chi phí ghi lô item (một câu, 1.000 item / 200 HĐ, có loại): có trigger ≤ 2× không trigger — báo số thật", async () => {
    await seed(T.acme, 1001, 200, [11, 12, 13, 14, 15]);
    const lot: Item[] = [];
    for (let g = 0; g < 200; g++)
      for (let o = 0; o < 5; o++)
        lot.push({ c: 1001 + g, tid: T.acme, ord: 100 + o, cat: 11 + ((g + o) % 5) });
    await timeLot(lot, 5);
    const on: number[] = [];
    const off: number[] = [];
    for (let r = 0; r < 3; r++) {
      on.push(...(await timeLot(lot, 10)));
      await sql`alter table contracts.contract_items disable trigger items_category_ins`;
      off.push(...(await timeLot(lot, 10)));
      await sql`alter table contracts.contract_items enable trigger items_category_ins`;
    }
    const p = (xs: number[], q: number) =>
      [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor(q * xs.length))] as number;
    console.log(
      `HD1 D-22 ghi lô 1.000 item: không trigger p50=${p(off, 0.5).toFixed(2)} p95=${p(off, 0.95).toFixed(2)} ms · có trigger p50=${p(on, 0.5).toFixed(2)} p95=${p(on, 0.95).toFixed(2)} ms`,
    );
    expect(p(on, 0.5)).toBeLessThanOrEqual(2 * p(off, 0.5));
  }, 120_000);
});
