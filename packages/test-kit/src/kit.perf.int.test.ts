// TK1 · Luật 4c (không thuộc Lệnh xong, `PERF=1 bun run test:perf`): đo harness + builder.
// Ngưỡng: dựng 10.000 hợp đồng bằng builder < 2.000 ms (1 câu); truy vấn danh sách theo tenant p95 ≤ 20 ms và KHÔNG Seq Scan
// (index `contracts_list_idx`); clone DB từ template ghi số thật (không ngưỡng cứng — phụ thuộc máy). Không `analyze` sau chèn hàng loạt.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { contracts, tenants, userId, users } from "./builders";
import { cloneDb, openOwner, rolePool, type Sql } from "./db";
import { assertNoSeqScan, captureSql, measure } from "./perf";

let sql: Sql;
const pool = rolePool(1);
let tid: string;
const cloneMs: number[] = [];
beforeAll(async () => {
  const t0 = performance.now();
  await cloneDb("full");
  cloneMs.push(performance.now() - t0);
  sql = openOwner(2);
  [tid] = (await tenants(sql, 1, 850)) as [string];
  await users(sql, tid, 1, { from: 850 });
});
afterAll(async () => {
  await pool.close();
  await sql.end({ timeout: 2 });
});

describe("harness perf kit", () => {
  it("dựng 10.000 hợp đồng bằng builder: 1 câu, < 2.000 ms", async () => {
    const t0 = performance.now();
    const cap = await captureSql(sql, () =>
      contracts(sql, tid, 10_000, { createdBy: userId(850) }),
    );
    const ms = performance.now() - t0;
    console.log(
      `[TK1 perf] contracts(10.000): ${ms.toFixed(0)} ms, ${cap.queries.length} câu; clone template: ${cloneMs[0]?.toFixed(0)} ms`,
    );
    expect(cap.queries.length).toBe(1);
    expect(ms).toBeLessThan(2000);
  });

  it("danh sách theo tenant: p95 ≤ 20 ms, không Seq Scan", async () => {
    const q =
      "select id from contracts.contracts where tenant_id = $1 order by updated_at desc, id desc limit 50";
    const run = <R>(f: (tx: Sql) => Promise<R>) => pool.inPack("contracts", tid, f);
    await assertNoSeqScan(run, { text: q, params: [tid] }, ["contracts"]);
    const stat = await measure(() => pool.inPack("contracts", tid, (tx) => tx.unsafe(q, [tid])), {
      n: 100,
      warm: 5,
    });
    console.log(
      `[TK1 perf] list p50=${stat.p50.toFixed(1)} p95=${stat.p95.toFixed(1)} max=${stat.max.toFixed(1)} ms (n=${stat.n}, kết nối giữ sẵn)`,
    );
    expect(stat.p95).toBeLessThanOrEqual(20);
  });
});
