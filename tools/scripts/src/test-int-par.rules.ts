// ADM-NFR-06 · `bun run test:int:par`: chia file int cho N worker song song (mỗi worker DB + Redis DB riêng), file không
// chạy song song được chạy tuần tự sau cùng. Hàm thuần; `test-int-par.ts` lo spawn. Thời lượng lấy từ JUnit lần trước.

/** File int không chạy song song được (đo bằng cách chạy, xem docs/TECH-DEBT.md); chạy tuần tự sau các shard. */
export const INT_SERIAL: readonly string[] = [];

export type Timings = Record<string, number>;
export type IntOpts = { workers: number; filters: string[] };

/** Redis DB 10..14 cho worker (15 = chạy tuần tự/mặc định, 13–14 chỉ e2e dùng khi không chạy int) → tối đa 5 worker. */
export const MAX_WORKERS = 5;

export function defaultWorkers(cores: number): number {
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

/** `--workers=N` (1..MAX_WORKERS), còn lại là tiền tố đường dẫn để lọc (vd `tests/acceptance/P-a`). */
export function parseIntArgs(argv: readonly string[], cores: number): IntOpts {
  const w = argv.find((a) => a.startsWith("--workers="))?.slice("--workers=".length);
  const n = w === undefined ? defaultWorkers(cores) : Number(w);
  if (!Number.isInteger(n) || n < 1 || n > MAX_WORKERS)
    throw new Error(`--workers phải là số nguyên 1..${MAX_WORKERS}, nhận ${JSON.stringify(w)}`);
  const filters = argv.filter((a) => !a.startsWith("--")).map(norm);
  return { workers: n, filters };
}

export const norm = (p: string) => p.replaceAll("\\", "/").replace(/^\.\//, "");

/** Lọc theo tiền tố (không lọc khi rỗng), tách danh sách tuần tự; giữ thứ tự đã sắp xếp. */
export function selectFiles(
  files: readonly string[],
  filters: readonly string[],
  serial: readonly string[] = INT_SERIAL,
): { parallel: string[]; serial: string[] } {
  const pre = filters.map(norm);
  const all = [...new Set(files.map(norm))]
    .filter((f) => !pre.length || pre.some((p) => f.startsWith(p)))
    .sort();
  const isSerial = new Set(serial.map(norm));
  return {
    parallel: all.filter((f) => !isSerial.has(f)),
    serial: all.filter((f) => isSerial.has(f)),
  };
}

/**
 * Chia `files` vào `n` shard. Có thời lượng: tham lam (file dài nhất trước, vào shard đang nhẹ nhất; file chưa có số đo
 * lấy trung bình các file đã đo). Không có số đo nào: chia vòng tròn. Kết quả ổn định với cùng đầu vào.
 */
export function partition(files: readonly string[], timings: Timings, n: number): string[][] {
  const shards: string[][] = Array.from({ length: n }, () => []);
  const known = files.map((f) => timings[f]).filter((t): t is number => typeof t === "number");
  if (!known.length) {
    for (const [i, f] of files.entries()) shards[i % n]?.push(f);
    return shards;
  }
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  const cost = (f: string) => timings[f] ?? avg;
  const load = new Array<number>(n).fill(0);
  const order = [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b));
  for (const f of order) {
    const i = load.indexOf(Math.min(...load));
    shards[i]?.push(f);
    load[i] = (load[i] ?? 0) + cost(f);
  }
  return shards;
}

/** Tổng thời lượng mỗi file (giây) từ JUnit của `bun test`: `<testsuite name="<file>" … time="…">` cấp ngoài cùng. */
export function parseJunit(xml: string): Timings {
  const out: Timings = {};
  let depth = 0;
  for (const m of xml.matchAll(/<(\/?)testsuite(\s[^>]*?)?(\/?)>/g)) {
    if (m[1]) {
      depth--;
      continue;
    }
    if (depth === 0) {
      const attrs = m[2] ?? "";
      const name = /\sname="([^"]*)"/.exec(attrs)?.[1];
      const time = Number(/\stime="([^"]*)"/.exec(attrs)?.[1]);
      if (name && Number.isFinite(time)) out[norm(unescapeXml(name))] = time;
    }
    if (!m[3]) depth++;
  }
  return out;
}

const unescapeXml = (s: string) =>
  s
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/** Tag DB của worker `i`: `w<i>` (Admin, biến TEST_*) và `w<i>_h1` (Hub/Runtime) — như hai DB chung khi chạy tuần tự. */
export const workerTags = (i: number) => ({ admin: `w${i}`, hub: `w${i}_h1` });

const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
};

/** Biến môi trường riêng worker `i`: 4 URL DB test trỏ DB của tag, Redis test DB `10+i`. Biến vắng thì bỏ qua. */
export function workerEnv(
  env: Readonly<Record<string, string | undefined>>,
  i: number,
  dbName: (tag: string) => string,
): Record<string, string> {
  const t = workerTags(i);
  const map: Record<string, string> = {
    TEST_DATABASE_URL: dbName(t.admin),
    TEST_ADMIN_API_DATABASE_URL: dbName(t.admin),
    HUB_TEST_DATABASE_URL: dbName(t.hub),
    AGENT_RT_TEST_DATABASE_URL: dbName(t.hub),
  };
  const out: Record<string, string> = {};
  for (const [k, name] of Object.entries(map)) {
    const v = env[k];
    if (v) out[k] = withDb(v, name);
  }
  const redis = env.REDIS_URL ?? "redis://localhost:6379";
  const r = new URL(redis);
  r.pathname = `/${10 + i}`;
  out.HUB_TEST_REDIS_URL = r.toString();
  return out;
}

/** Đọc cặp KEY=VALUE đơn giản của `.env.local` (bỏ comment, bỏ ngoặc kép bao ngoài). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m?.[1]) out[m[1]] = (m[2] ?? "").replace(/^"(.*)"$/, "$1");
  }
  return out;
}
