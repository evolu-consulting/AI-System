// ADM-NFR-06 · `bun run test:int:par`: chia file int cho N worker song song (mỗi worker DB + Redis DB riêng), file không
// chạy song song được chạy tuần tự sau cùng. Hàm thuần; `test-int-par.ts` lo spawn. Thời lượng lấy từ JUnit lần trước.

/** File int không chạy song song được (đo bằng cách chạy, xem docs/TECH-DEBT.md); chạy tuần tự sau các shard. */
export const INT_SERIAL: readonly string[] = [];

export type Timings = Record<string, number>;
export type IntOpts = { workers: number; filters: string[] };

/** Tối đa worker một lượt (ô 1..12 chia giữa các lượt chạy cùng lúc, xem `test-db-cli lease`). */
export const MAX_WORKERS = 8;

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

/** Chi phí ước lượng mỗi file (giây): số đo JUnit lần trước; chưa đo → trung bình các file đã đo (không có gì: 1). */
export function costOf(timings: Timings): (f: string) => number {
  const known = Object.values(timings);
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  return (f) => timings[f] ?? avg;
}

/** Hàng đợi chung, file nặng trước (LPT); hoà thì theo tên để thứ tự ổn định. */
export function lptQueue(files: readonly string[], timings: Timings): string[] {
  const cost = costOf(timings);
  return [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b));
}

/**
 * Worker vừa rảnh lấy một lô từ đầu hàng đợi (sửa `queue`): ít nhất 1 file, cộng dồn tới ~phần còn lại / (3·workers)
 * (kẹp 3–30 s). Lô to lúc đầu đỡ chi phí khởi động `bun test`; lô nhỏ dần về cuối để các worker xong gần cùng lúc.
 */
export function takeChunk(queue: string[], timings: Timings, workers: number): string[] {
  const cost = costOf(timings);
  const remaining = queue.reduce((a, f) => a + cost(f), 0);
  const target = Math.min(30, Math.max(3, remaining / (3 * Math.max(1, workers))));
  const out: string[] = [];
  let acc = 0;
  while (queue.length && (!out.length || acc + cost(queue[0] ?? "") <= target)) {
    const f = queue.shift() as string;
    out.push(f);
    acc += cost(f);
  }
  return out;
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

/** Tag DB của ô `s`: `s<s>` (Admin, biến TEST_*) và `s<s>_h1` (Hub/Runtime) — như hai DB chung khi chạy tuần tự. */
export const workerTags = (s: number) => ({ admin: `s${s}`, hub: `s${s}_h1` });

/** Số worker thực: 1–2 file ⇒ 1 worker; không quá số file, số ô thuê được. */
export function workerCount(want: number, files: number, slots: number): number {
  return Math.max(1, Math.min(files <= 2 ? 1 : want, files, slots));
}

const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
};

/** Biến môi trường riêng ô `i`: 4 URL DB test trỏ DB của tag, Redis test DB `i`. Biến vắng thì bỏ qua. */
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
  r.pathname = `/${i}`;
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
