// CR-116 probe · công cụ đo (không đổi hành vi): `probe(name, fn)` đo wall ms, CPU ms (process.cpuUsage), RSS delta (KiB) và
// — với DB — số câu SQL + round trip qua tap `debug` của postgres.js (`createDb` cài khi bật). Tắt (mặc định) ⇒ `probe` chỉ gọi
// `fn()` (một so sánh boolean), không ghi gì, không cài tap. Bật bằng env `PERF_PROBE=1` (đọc MỘT lần lúc nạp module).
// Một dòng kv/lần đo, cùng ngữ pháp `apps/hub-api/src/lib/log-kv.ts`: `t=<epoch s> e=probe.<tên> ms= cpu= rss= sql= rt=`.
// Lưu ý: cpu/rss/sql/rt là SỐ ĐO TOÀN TIẾN TRÌNH trong khoảng probe — chạy kịch bản tuần tự để số không lẫn việc khác.
// `sql` = câu nghiệp vụ (không tính begin/commit/savepoint/type-discovery, như `captureSql` của test-kit);
// `rt` ≈ round trip: các câu cùng một kết nối gửi trong cùng một lượt event-loop (pipeline) tính 1.

export type ProbeSample = {
  name: string;
  ms: number;
  cpu: number;
  rss: number;
  sql: number;
  rt: number;
};

let enabled = process.env.PERF_PROBE === "1";
/** Bật/tắt tay (test). Không đụng env. */
export const setProbe = (on: boolean): void => {
  enabled = on;
};
export const probeOn = (): boolean => enabled;

// ---- tap SQL (cài vào postgres.js `debug` bởi createDb khi bật) ----
const CTL =
  /^\s*((begin|commit|rollback|savepoint|release)\b|select b\.oid, b\.typarray from pg_catalog\.pg_type)/i;
const TYPE_DISCOVERY = /^\s*select b\.oid, b\.typarray from pg_catalog\.pg_type/i;
let sqlCount = 0;
let rtCount = 0;
let epoch = 0;
let bumpScheduled = false;
const lastEpoch = new Map<number, number>();

/** Hàm `debug` của postgres.js: đếm câu + round trip. Chuỗi hoá với `prev` (nếu có). */
export function sqlTap(
  prev?: (conn: number, q: string, params: unknown[], ...rest: unknown[]) => void,
): (conn: number, q: string, params: unknown[], ...rest: unknown[]) => void {
  return (conn, q, params, ...rest) => {
    if (typeof prev === "function") prev(conn, q, params, ...rest);
    if (TYPE_DISCOVERY.test(q)) return;
    if (!CTL.test(q)) sqlCount++;
    if (lastEpoch.get(conn) !== epoch) {
      rtCount++;
      lastEpoch.set(conn, epoch);
    }
    if (!bumpScheduled) {
      bumpScheduled = true;
      setImmediate(() => {
        epoch++;
        bumpScheduled = false;
      });
    }
  };
}
export const sqlCounters = (): { sql: number; rt: number } => ({ sql: sqlCount, rt: rtCount });

// ---- bộ gom trong tiến trình ----
const samples: ProbeSample[] = [];
const MAX_SAMPLES = 200_000;
export const probeSamples = (): readonly ProbeSample[] => samples;
export const resetProbe = (): void => {
  samples.length = 0;
};

const r1 = (x: number): number => Math.round(x * 10) / 10;

/** Dòng kv chuẩn của một mẫu (hoặc sự kiện tuỳ ý với `extra`). */
export function probeLine(
  name: string,
  f: Record<string, number | string | undefined>,
  now = Date.now(),
): string {
  const parts = [`t=${Math.floor(now / 1000)}`, `e=probe.${name}`];
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    const s = String(v);
    parts.push(/[\s="\\]/.test(s) ? `${k}="${s.replace(/(["\\])/g, "\\$1")}"` : `${k}=${s}`);
  }
  return parts.join(" ");
}

/** Ghi một dòng probe ra stdout (chỉ khi bật). */
export function probeEmit(name: string, f: Record<string, number | string | undefined>): void {
  if (enabled) process.stdout.write(`${probeLine(name, f)}\n`);
}

function begin(): { t: number; c: NodeJS.CpuUsage; r: number; s: number; q: number } {
  return {
    t: performance.now(),
    c: process.cpuUsage(),
    r: process.memoryUsage.rss(),
    s: sqlCount,
    q: rtCount,
  };
}
function finish(name: string, b: ReturnType<typeof begin>): void {
  const c = process.cpuUsage(b.c);
  const s: ProbeSample = {
    name,
    ms: r1(performance.now() - b.t),
    cpu: r1((c.user + c.system) / 1000),
    rss: Math.round((process.memoryUsage.rss() - b.r) / 1024),
    sql: sqlCount - b.s,
    rt: rtCount - b.q,
  };
  if (samples.length < MAX_SAMPLES) samples.push(s);
  const { name: n, ...rest } = s;
  process.stdout.write(`${probeLine(n, rest)}\n`);
}

/** Đo `fn` (bất đồng bộ). Tắt ⇒ trả thẳng `fn()`. Lỗi ném ra vẫn ghi mẫu. */
export function probe<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();
  const b = begin();
  return fn().finally(() => finish(name, b));
}

/** Như `probe` cho hàm đồng bộ. */
export function probeSync<T>(name: string, fn: () => T): T {
  if (!enabled) return fn();
  const b = begin();
  try {
    return fn();
  } finally {
    finish(name, b);
  }
}

// ---- thống kê ----
/** Phân vị gần nhất (như `percentile` của test-kit), p ∈ [0,100]. */
export function pctile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] as number;
}
export type ProbeStat = { n: number; p50: number; p95: number; mean: number };
/** Gom mẫu trong tiến trình theo tên probe. */
export function probeStats(from: readonly ProbeSample[] = samples): Record<string, ProbeStat> {
  const by = new Map<string, number[]>();
  for (const s of from) by.set(s.name, [...(by.get(s.name) ?? []), s.ms]);
  const out: Record<string, ProbeStat> = {};
  for (const [k, xs] of by)
    out[k] = {
      n: xs.length,
      p50: pctile(xs, 50),
      p95: pctile(xs, 95),
      mean: r1(xs.reduce((a, x) => a + x, 0) / xs.length),
    };
  return out;
}
