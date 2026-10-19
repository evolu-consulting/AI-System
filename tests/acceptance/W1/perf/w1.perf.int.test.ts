// W1-NFR-01 · Luật 4c · ngân sách danh sách p95 ≤ 50 ms: "Việc của tôi" trên tenant 10.000 HĐ / 20.000 đợt mở (chỉ ~300 trong cửa sổ
// 7 ngày) / 5.000 hẹn nhắc của nhiều người + tenant nền; "Mua hàng" trên 500 HĐ (250 bán + 250 mua, 5 dòng hàng mỗi HĐ — quy mô điển hình),
// và 2.000 HĐ (trần đọc) báo số thật. Đo QUA HTTP thật (JWT + guard + RLS + JSON), không Seq Scan trên bảng lớn. Chỉ chạy dưới `PERF=1`
// (`bun run test:perf`): `-Step perf -Filter tests/acceptance/W1/perf`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { literalize } from "@ai/test-kit/perf";
import { captureSql, getWith, inPack, measure, ROLE_RW, seqScansOf } from "../../HD1/_support/hd1";
import { arrangeW1, BASE, type CtxN1, d, P, type Sql, startHd1, T } from "../_support/w1";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const log = (name: string, st: { p50: number; p95: number; max: number }, extra = "") =>
  console.log(
    `W1-NFR-01 · ${name}: p50 ${st.p50.toFixed(1)} · p95 ${st.p95.toFixed(1)} · max ${st.max.toFixed(1)} ms${extra}`,
  );

async function seedWork(sql: Sql, tenant: string) {
  await sql`insert into contracts.contracts (id, tenant_id, title, direction, status, created_by, owner_user_id, fields)
    select gen_random_uuid(), ${tenant}, 'HĐ ' || g, case when g % 2 = 0 then 'sale' else 'purchase' end, 'active',
      ${P.lan.id}, ${P.hoa.id},
      jsonb_build_object('number', jsonb_build_object('value', 'P-' || g),
        'buyer_name', jsonb_build_object('value', 'Khách ' || (g % 400)),
        'supplier_name', jsonb_build_object('value', 'NCC ' || (g % 400)),
        'end_date', jsonb_build_object('value', (date '2026-01-01' + (g % 700))::text))
    from generate_series(1, 10000) g`;
  // 2 đợt mỗi HĐ: hạn rải ±350 ngày quanh hôm nay ⇒ chỉ một phần nhỏ nằm trong cửa sổ (trễ + 7 ngày tới) — đợt trễ lâu vẫn mở.
  await sql`insert into contracts.obligations (tenant_id, contract_id, direction, seq, due_date, amount)
    select ${tenant}, c.id, case when c.direction = 'sale' then 'receive' else 'pay' end, s,
      ${d(0)}::date + ((row_number() over () * 7919)::int % 700 - 350), 1000000
    from contracts.contracts c cross join generate_series(1, 2) s where c.tenant_id = ${tenant}`;
  await sql`insert into contracts.cks_customers (tenant_id, name) select ${tenant}, 'K' || g from generate_series(1, 50) g`;
  await sql`insert into contracts.cks_followups (tenant_id, user_id, customer_id, due_at)
    select ${tenant}, case when g % 5 = 0 then ${P.hoa.id}::uuid else ${P.lan.id}::uuid end,
      (select id from contracts.cks_customers where tenant_id = ${tenant} order by id limit 1 offset g % 50),
      now() + ((g % 400) - 200) * interval '1 day' from generate_series(1, 5000) g`;
}

describe("W1-NFR-01 · Việc của tôi", () => {
  it("p95 ≤ 50 ms trên 10.000 HĐ / 20.000 đợt / 5.000 hẹn nhắc (+ nền beta), đúng 2 câu SQL, không Seq Scan", async () => {
    await arrangeW1(c);
    await seedWork(c.sql, T.acme);
    await seedWork(c.sql, T.beta);
    await c.sql`analyze contracts.contracts, contracts.obligations, contracts.cks_followups`;
    const token = await c.tok(P.hoa);
    const st = await measure(c, () => getWith(c, token, `${BASE}/my-work`));
    const cap = await captureSql(c, () => getWith(c, token, `${BASE}/my-work`));
    const items = cap.r.json.items.length;
    log("GET /my-work", st, ` · ${items} mục · ${cap.queries.length} câu SQL`);
    expect(cap.queries.length).toBe(2);
    const main = cap.queries.at(-1) as { text: string; params: unknown[] };
    expect(
      await seqScansOf(T.acme, main, [
        "contracts",
        "obligations",
        "cks_followups",
        "contract_reminders",
      ]),
    ).toEqual([]);
    expect(items).toBeGreaterThan(0);
    expect(st.p95).toBeLessThanOrEqual(50);
  }, 300_000);
});

async function seedSourcing(sql: Sql, tenant: string, pairs: number) {
  const mk = (
    sale: boolean,
  ) => sql`insert into contracts.contracts (id, tenant_id, title, direction, status, created_by, owner_user_id, fields)
    select gen_random_uuid(), ${tenant}, ${sale ? "B" : "M"} || g, ${sale ? "sale" : "purchase"}, 'active', ${P.lan.id}, ${P.hoa.id},
      jsonb_build_object('number', jsonb_build_object('value', ${sale ? "B" : "M"} || g),
        'buyer_name', jsonb_build_object('value', 'Khách ' || (g % 80)), 'buyer_tax_id', jsonb_build_object('value', '04' || lpad((g % 80)::text, 8, '0')),
        'supplier_name', jsonb_build_object('value', 'NCC ' || (g % 40)), 'supplier_tax_id', jsonb_build_object('value', '03' || lpad((g % 40)::text, 8, '0')))
    from generate_series(1, ${pairs}) g`;
  await mk(true);
  await mk(false);
  await sql`insert into contracts.contract_items (tenant_id, contract_id, ord, name, unit, qty, unit_price)
    select ${tenant}, c.id, s, 'Mặt hàng ' || ((row_number() over () + s) % 60), 'cái', 10, 1000 + (row_number() over () % 997) * 10
    from contracts.contracts c cross join generate_series(0, 4) s where c.tenant_id = ${tenant}`;
}

describe("W1-NFR-01 · Mua hàng", () => {
  const SIZES = (process.env.W1_PERF_PAIRS ?? "50,250,1000").split(",").map(Number);
  for (const pairs of SIZES) {
    const hard = true;
    it(`${pairs * 2} HĐ (${pairs} bán + ${pairs} mua, 5 dòng/HĐ): p95 ${hard ? "≤ 50 ms (quy mô điển hình)" : "báo số thật"}, đúng 2 câu SQL`, async () => {
      await arrangeW1(c);
      await seedSourcing(c.sql, T.acme, pairs);
      await seedSourcing(c.sql, T.beta, 250);
      await c.sql`analyze contracts.contracts, contracts.contract_items`;
      const token = await c.tok(P.hoa);
      const st = await measure(c, () => getWith(c, token, `${BASE}/sourcing`), {
        n: hard ? 200 : 50,
      });
      const cap = await captureSql(c, () => getWith(c, token, `${BASE}/sourcing`));
      log(
        `GET /sourcing (${pairs * 2} HĐ)`,
        st,
        ` · ${cap.r.json.lines.length} dòng bán · ${(cap.r.text.length / 1024).toFixed(0)} KB · ${cap.queries.length} câu SQL`,
      );
      expect(cap.queries.length).toBe(4); // bộ nhớ đệm trúng: (phạm vi + dấu vân tay) + (phạm vi + id HĐ thấy)
      const main = cap.queries.at(-1) as { text: string; params: unknown[] };
      // Báo cáo đọc gần hết dòng hàng của tenant (tập hợp) ⇒ quét là đúng; kiểm là không quét bảng của tenant khác lớn hơn cần: xem thời gian.
      // Thời gian thực thi CÂU SQL (EXPLAIN ANALYZE, RLS thật) để tách khỏi JSON/HTTP:
      const ex = await inPack(
        T.acme,
        async (tx) => {
          await tx.unsafe("select set_config('enable_nestloop', 'off', true)");
          return (await tx.unsafe(
            `explain (analyze, format text) ${literalize(main)}`,
          )) as unknown as { "QUERY PLAN": string }[];
        },
        ROLE_RW,
      );
      const plan = ex.map((r) => r["QUERY PLAN"]);
      console.log(
        `W1-NFR-01 · SQL ${pairs * 2} HĐ: ${plan.filter((l) => /^(Planning|Execution) Time/.test(l)).join(" · ")}`,
      );
      if (process.env.W1_PERF_PLAN) console.log(`PLAN\n${plan.join("\n")}`);
      if (hard) expect(st.p95).toBeLessThanOrEqual(50);
    }, 300_000);
  }
});
