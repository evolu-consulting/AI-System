// Gap #8 · Luật 4c: xuất 10.000 HĐ (xlsx và csv) ≤ 2 s đo từ lúc gửi tới khi nhận đủ thân; số câu SQL cố định (không theo số hàng).
// Chạy trong `PERF=1 bun --config=bunfig.perf.toml test tests/acceptance/HD1/perf/export.perf.int.test.ts`. Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import {
  arrange,
  CBASE,
  type CtxN1,
  captureSql,
  ensureRoles,
  P,
  startHd1,
  T,
} from "../_support/hd1";

let c: CtxN1;
const N = 10_000;
beforeAll(async () => {
  c = await startHd1();
  await arrange(c);
  await ensureRoles(c);
  await c.sql`insert into contracts.contracts (id, tenant_id, title, created_by, status, direction, owner_user_id, updated_at, fields)
    select ('c0de0000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, ${T.acme}::uuid, 'Hợp đồng số ' || g, ${P.lan.id}::uuid,
      'active', case g % 3 when 0 then 'sale' when 1 then 'purchase' end, ${P.lan.id}::uuid,
      timestamptz '2026-01-01T00:00:00Z' + g * interval '1 minute',
      jsonb_build_object('number', jsonb_build_object('value', 'HD-' || g),
        'supplier_name', jsonb_build_object('value', 'Công ty bên bán ' || (g % 200)),
        'buyer_name', jsonb_build_object('value', 'Công ty bên mua ' || (g % 300)),
        'total_value', jsonb_build_object('value', g * 1000),
        'end_date', jsonb_build_object('value', to_char(date '2026-01-01' + (g % 700), 'YYYY-MM-DD')))
    from generate_series(1, ${N}::int) g`;
  await c.sql`analyze contracts.contracts`;
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

async function once(token: string, qs: string) {
  const t0 = performance.now();
  const res = await fetch(`${c.hub.base}${CBASE}/export${qs}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { ms: performance.now() - t0, res, bytes };
}

describe("Gap #8 · hiệu năng xuất tệp", () => {
  for (const fmt of ["xlsx", "csv"] as const) {
    it(`${fmt}: 10.000 HĐ ≤ 2 s (lượt chậm nhất của 5), đủ hàng`, async () => {
      const token = await c.tok(P.lan);
      await once(token, `?format=${fmt}`); // làm nóng (pool, plan)
      const runs: number[] = [];
      let last = await once(token, `?format=${fmt}`);
      for (let i = 0; i < 5; i++) {
        last = await once(token, `?format=${fmt}`);
        runs.push(last.ms);
      }
      const max = Math.max(...runs);
      const rows =
        fmt === "xlsx"
          ? (strFromU8(unzipSync(last.bytes)["xl/worksheets/sheet1.xml"] as Uint8Array).match(
              /<row /g,
            )?.length ?? 0) - 1
          : new TextDecoder().decode(last.bytes).trimEnd().split("\r\n").length - 1;
      console.log(
        `Gap #8 · ${fmt} · ${N} HĐ · runs=${runs.map((m) => m.toFixed(0)).join("/")} ms · max=${max.toFixed(0)} ms (ngưỡng 2000) · ${(last.bytes.length / 1024).toFixed(0)} KiB`,
      );
      expect({
        status: last.res.status,
        rows,
        truncated: last.res.headers.get("x-export-truncated"),
      }).toEqual({
        status: 200,
        rows: N,
        truncated: "0",
      });
      expect(max).toBeLessThanOrEqual(2000);
    }, 120_000);
  }
  it("số câu SQL cố định: 10.000 hàng ⇒ ≤ 5 câu (set_config + lọc + loại hàng + phụ trách), không theo số hàng", async () => {
    const token = await c.tok(P.lan);
    const { queries } = await captureSql(c, async () => {
      await once(token, "?format=xlsx");
      return { status: 200 } as never;
    });
    console.log(`Gap #8 · SQL cho xuất ${N} HĐ = ${queries.length}`);
    expect(queries.length).toBeLessThanOrEqual(5);
  });
});
