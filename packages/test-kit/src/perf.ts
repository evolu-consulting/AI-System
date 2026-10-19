// TK1 · harness perf (Luật 4c): p95, đếm câu SQL, EXPLAIN không Seq Scan. Thuần + một tap `postgres.js`.
import type { Sql } from "./db";

export const percentile = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) throw new Error("percentile: mảng rỗng");
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] as number;
};

export type Stat = { n: number; p50: number; p95: number; max: number };
export const latencyStats = (ms: readonly number[]): Stat => ({
  n: ms.length,
  p50: percentile(ms, 50),
  p95: percentile(ms, 95),
  max: Math.max(...ms),
});

/** Làm nóng `warm` lượt (không tính) rồi đo `n` lượt tuần tự. `one(i)` ném khi sai; i < 0 là lượt nóng. */
export async function measure(
  one: (i: number) => Promise<unknown>,
  o: { n?: number; warm?: number } = {},
): Promise<Stat> {
  const n = o.n ?? 200;
  for (let i = 0; i < (o.warm ?? 10); i++) await one(-1 - i);
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await one(i);
    ms.push(performance.now() - t0);
  }
  return latencyStats(ms);
}

export type Cap = { text: string; params: unknown[] };
/** Câu điều khiển giao dịch / type-discovery không tính vào "số câu SQL nghiệp vụ". */
const CTL =
  /^\s*((begin|commit|rollback|savepoint|release)\b|select b\.oid, b\.typarray from pg_catalog\.pg_type)/i;
type PoolOpts = {
  debug?: (conn: number, q: string, params: unknown[], ...rest: unknown[]) => void;
};

/** Tap `debug` của một client postgres.js (hoặc pool app: truyền `client`), chụp câu trong `fn`. Khôi phục tap cũ khi xong. */
export async function captureSql<R>(
  client: Sql,
  fn: () => Promise<R>,
): Promise<{ r: R; queries: Cap[] }> {
  const opts = (client as unknown as { options: PoolOpts }).options;
  const prev = opts.debug;
  const queries: Cap[] = [];
  opts.debug = (conn, q, params, ...rest) => {
    if (typeof prev === "function") prev(conn, q, params, ...rest);
    if (!CTL.test(q)) queries.push({ text: q, params: params ?? [] });
  };
  try {
    return { r: await fn(), queries };
  } finally {
    opts.debug = prev;
  }
}
export const countStatements = async (client: Sql, fn: () => Promise<unknown>): Promise<number> =>
  (await captureSql(client, fn)).queries.length;

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  if (Array.isArray(v))
    return `'{${v.map((e) => `"${String(e).replace(/(["\\])/g, "\\$1")}"`).join(",")}}'`;
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
/** Thay `$n` bằng literal để EXPLAIN ra kế hoạch tuỳ chỉnh với hằng. */
export const literalize = (cap: Cap): string =>
  cap.text.replace(/\$(\d+)/g, (_m, n: string) => lit(cap.params[Number(n) - 1]));

export type PlanNode = { "Node Type": string; "Relation Name"?: string; Plans?: PlanNode[] };
/** Quan hệ (thuộc `rels`) bị `Seq Scan` trong kế hoạch. `rels` rỗng = mọi quan hệ. */
export function seqScansIn(node: PlanNode, rels: readonly string[] = []): string[] {
  const name = node["Relation Name"];
  const own =
    node["Node Type"] === "Seq Scan" && name && (rels.length === 0 || rels.includes(name))
      ? [name]
      : [];
  return own.concat(...(node.Plans ?? []).map((p) => seqScansIn(p, rels)));
}

/** EXPLAIN câu bằng `run` (vd `(f) => inPack("x", tid, f)` để RLS thật). Trả quan hệ bị Seq Scan. */
export async function seqScansOf(
  run: <R>(fn: (tx: Sql) => Promise<R>) => Promise<R>,
  cap: Cap | string,
  rels: readonly string[] = [],
): Promise<string[]> {
  const text = typeof cap === "string" ? cap : literalize(cap);
  return run(async (tx) => {
    const rows = (await tx.unsafe(`explain (format json) ${text}`)) as unknown as {
      "QUERY PLAN": { Plan: PlanNode }[];
    }[];
    const plan = rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
    if (!plan) throw new Error("EXPLAIN không trả kế hoạch");
    return seqScansIn(plan, rels);
  });
}

/** Ném khi có Seq Scan trên `rels` — dùng sau khi bảng đủ lớn (`analyze`) để kế hoạch dùng index. */
export async function assertNoSeqScan(
  run: <R>(fn: (tx: Sql) => Promise<R>) => Promise<R>,
  cap: Cap | string,
  rels: readonly string[] = [],
): Promise<void> {
  const seq = await seqScansOf(run, cap, rels);
  if (seq.length) throw new Error(`Seq Scan trên: ${seq.join(", ")}`);
}
