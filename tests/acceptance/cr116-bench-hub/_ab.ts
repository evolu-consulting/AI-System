// CR-116 · bench hub (chỉ đo): khung A/B — chạy biến thể hiện tại và các biến thể thay thế trên CÙNG dữ liệu đã seed, xen kẽ
// thứ tự (không lệch nóng/lạnh), so kết quả (JSON chuẩn hoá) với biến thể đầu, đo p50/p95/tổng + số câu SQL mỗi lượt.
// Không chứa `it`. In một dòng `[ab] …` mỗi biến thể (report.md lấy từ đây).
import type { Sql } from "@ai/test-kit/db";
import { captureSql, percentile } from "@ai/test-kit/perf";

export type Variant<R> = { name: string; run: (sql: Sql, i: number) => Promise<R> };
export type AbRow = {
  cand: string;
  variant: string;
  rows: number;
  p50: number;
  p95: number;
  total: number;
  sqlCount: number;
  equal: boolean;
};

const norm = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x instanceof Date ? x.toISOString() : typeof x === "bigint" ? String(x) : x,
  );

/** `reset` (tuỳ chọn) chạy NGOÀI khoảng đo trước mỗi lượt (vd trả hàng về trạng thái chưa xử lý cho biến thể ghi). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: khung bench (chỉ đo)
export async function ab<R>(
  sql: Sql,
  o: {
    cand: string;
    rows: number;
    variants: Variant<R>[];
    n?: number;
    warm?: number;
    canon?: (r: R) => unknown;
    reset?: (sql: Sql) => Promise<void>;
  },
): Promise<AbRow[]> {
  const n = o.n ?? 40;
  const canon = o.canon ?? ((r: R) => r);
  const ms: number[][] = o.variants.map(() => []);
  const base: string[] = [];
  const results: string[][] = o.variants.map(() => []);
  for (let w = 0; w < (o.warm ?? 5); w++)
    for (const v of o.variants) {
      await o.reset?.(sql);
      await v.run(sql, -1 - w);
    }
  for (let i = 0; i < n; i++)
    for (let k = 0; k < o.variants.length; k++) {
      // xen kẽ: lượt chẵn thứ tự xuôi, lẻ thứ tự ngược
      const j = i % 2 === 0 ? k : o.variants.length - 1 - k;
      const v = o.variants[j] as Variant<R>;
      await o.reset?.(sql);
      const t0 = performance.now();
      const r = await v.run(sql, i);
      (ms[j] as number[]).push(performance.now() - t0);
      if (i < 3) (results[j] as string[]).push(norm(canon(r)));
    }
  for (const s of results[0] as string[]) base.push(s);
  const out: AbRow[] = [];
  for (const [j, v] of o.variants.entries()) {
    await o.reset?.(sql);
    const { queries } = await captureSql(sql, () => v.run(sql, 0));
    const xs = ms[j] as number[];
    const row: AbRow = {
      cand: o.cand,
      variant: v.name,
      rows: o.rows,
      p50: +percentile(xs, 50).toFixed(2),
      p95: +percentile(xs, 95).toFixed(2),
      total: +xs.reduce((a, b) => a + b, 0).toFixed(1),
      sqlCount: queries.length,
      equal: (results[j] as string[]).every((s, i) => s === base[i]),
    };
    console.log(
      `[ab] ${row.cand} | ${row.variant} | rows=${row.rows} | p50=${row.p50} | p95=${row.p95} | total=${row.total} | sql=${row.sqlCount} | equal=${row.equal ? "✓" : "✗"}`,
    );
    out.push(row);
  }
  return out;
}

/** EXPLAIN (ANALYZE, BUFFERS) gọn: dòng gốc + các nút quét. In `[explain] cand variant …`. */
export async function explain(
  sql: Sql,
  cand: string,
  variant: string,
  text: string,
): Promise<void> {
  await sql
    .begin(async (tx) => {
      const rows = (await tx.unsafe(
        `explain (analyze, buffers, costs off, timing on) ${text}`,
      )) as unknown as {
        "QUERY PLAN": string;
      }[];
      const lines = rows.map((r) => r["QUERY PLAN"]);
      const keep = lines.filter(
        (l, i) => i === 0 || /Scan|Join|Loop|Sort|Aggregate|Buffers|Execution/.test(l),
      );
      for (const l of keep.slice(0, 14))
        console.log(`[explain] ${cand} | ${variant} | ${l.trim()}`);
      throw new RollbackSignal(); // EXPLAIN ANALYZE chạy thật ⇒ huỷ mọi ghi
    })
    .catch((e) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
}
class RollbackSignal extends Error {}
