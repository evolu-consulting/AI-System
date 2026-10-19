// PK-NFR-05 · PK-NFR-03 · PK-BR-01 (không thuộc Lệnh xong, `bun run test:perf`) · plan §10: `POST /pack/pkdemo/items` lô 100 con
// p95 ≤ 30 ms, `GET /pack/pkdemo/items/:id` p95 ≤ 10 ms; 1.000 lượt mỗi loại, 10.000 hàng nền. Báo số thật. Số câu SQL cố định
// trong suốt phép đo (không tăng theo số hàng nền).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxN1,
  countHops,
  itemBody,
  needPackKit,
  P,
  PK,
  percentile,
  startN1,
  T,
  untilHubSettles,
} from "../_support/n1";

let c: CtxN1;
beforeAll(async () => {
  c = await startN1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
const N = 1000;
const WARM = 50;

describe("PK-NFR-05 · pkdemo p95 với 10.000 hàng nền", () => {
  it("PK-NFR-05 · POST lô 100 con p95 ≤ 30 ms · GET cha+con p95 ≤ 10 ms (1.000 lượt) · mỗi POST đúng 3 câu SQL", async () => {
    await needPackKit(c.sql);
    await c.enable(T.acme);
    await c.addToRole(T.acme, "editor", [P.hoa]);
    // 10.000 hàng nền (set-based, owner): 100 cha × 100 con, cả hai tenant để RLS có việc lọc
    await c.sql`truncate pkdemo.item_lines, pkdemo.items, pkdemo.index_outbox`;
    await c.sql`insert into pkdemo.items (id, tenant_id, title)
      select gen_random_uuid(), case when g % 2 = 0 then ${T.acme}::uuid else ${T.beta}::uuid end, 'nền ' || g from generate_series(1, 100) g`;
    await c.sql`insert into pkdemo.item_lines (tenant_id, item_id, text)
      select i.tenant_id, i.id, 'dòng ' || l from pkdemo.items i, generate_series(1, 100) l`;
    await c.sql`analyze pkdemo.items`;
    await c.sql`analyze pkdemo.item_lines`;
    const ready = await untilHubSettles(
      c.hub,
      async () => (await c.hubCall(P.hoa, "GET", `/pack/${PK}/me`)).json?.actions ?? [],
      (x: string[]) => x.includes("write"),
    );
    expect(ready).toEqual(["read", "write"]);

    const body = itemBody("đo", 100);
    for (let i = 0; i < WARM; i++) await c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, body);
    const postMs: number[] = [];
    let lastId = "";
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const r = await c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, body);
      postMs.push(performance.now() - t0);
      if (r.status !== 201) throw new Error(`POST lượt ${i} ⇒ ${r.status} ${r.text.slice(0, 120)}`);
      lastId = r.json.id;
    }
    const getMs: number[] = [];
    for (let i = 0; i < WARM; i++) await c.hubCall(P.hoa, "GET", `/pack/${PK}/items/${lastId}`);
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const r = await c.hubCall(P.hoa, "GET", `/pack/${PK}/items/${lastId}`);
      getMs.push(performance.now() - t0);
      if (r.status !== 200) throw new Error(`GET lượt ${i} ⇒ ${r.status}`);
    }
    const hops = await countHops(c, () => c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, body));
    const post95 = percentile(postMs, 95);
    const get95 = percentile(getMs, 95);
    console.log(
      `PK-NFR-05 · POST lô 100: p50=${percentile(postMs, 50).toFixed(2)} p95=${post95.toFixed(2)} ms (ngưỡng 30) · GET: p50=${percentile(getMs, 50).toFixed(2)} p95=${get95.toFixed(2)} ms (ngưỡng 10) · câu SQL/POST=${hops.sql} · nền ${100 * 100 + N * 100} hàng con`,
    );
    expect(hops.sql).toBe(3);
    expect(post95).toBeLessThanOrEqual(30);
    expect(get95).toBeLessThanOrEqual(10);
  }, 300_000);
});
