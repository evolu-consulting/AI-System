// TS1 · `bun run test:e2e:par` (và bước e2e của `test:all`): chạy MỌI cấu hình Playwright song song có kiểm soát.
// Hàm thuần: nhận danh sách cấu hình + file spec gốc + thời lượng đã đo, trả danh sách "việc" (job) mỗi việc có DB test,
// Redis DB, cổng và thư mục dựng riêng (không hai việc chạy cùng lúc dùng chung). `test-e2e-par.ts` lo spawn.

/** Redis DB cấp cho các việc e2e (0 = dev, 1..6 = ô worker của test:int:par; DB 7–15 dành cho e2e). */
export const REDIS_DBS: readonly number[] = [7, 8, 9, 10, 11, 12, 13, 14, 15];

export type Meta = {
  /** Tag DB test riêng (`ai_system_e2e_<tag>_test`); vắng = việc không dùng DB (mock thuần). */
  db?: string;
  /** Biến env mang Redis DB: `db` ⇒ số, `url` ⇒ `redis://localhost:6379/<n>`. */
  redis?: { kind: "db" | "url"; vars: string[] };
  /** Biến env cố định thêm (đổi cổng mặc định đụng việc khác chạy cùng lúc). */
  env?: Record<string, string>;
  /** Ước lượng giây (lượt GX2) khi chưa có số đo mới. */
  cost: number;
};

const REDIS_DB = (v: string): Meta["redis"] => ({ kind: "db", vars: [v] });
const REDIS_URL = (v: string): Meta["redis"] => ({ kind: "url", vars: [v] });

/** Siêu dữ liệu theo cấu hình; cấu hình lạ ⇒ `fallbackMeta` (có DB riêng, không Redis). */
export const META: Record<string, Meta> = {
  "e2e/K1/playwright.k1.config.ts": { db: "k1", redis: REDIS_DB("K1_REDIS_DB"), cost: 30 },
  "e2e/N1/playwright.config.ts": { cost: 21 },
  "e2e/N2/playwright.n2.config.ts": { db: "n2", redis: REDIS_DB("N2_REDIS_DB"), cost: 22 },
  "e2e/ops/playwright.ops.config.ts": { db: "ops", redis: REDIS_DB("OPS_REDIS_DB"), cost: 40 },
  "e2e/P-a/playwright.pa.config.ts": { db: "pa", redis: REDIS_DB("PA_REDIS_DB"), cost: 150 },
  "e2e/P-b/playwright.pb.config.ts": { db: "pb", redis: REDIS_DB("PB_REDIS_DB"), cost: 69 },
  "e2e/P-b2/playwright.pb2.config.ts": { db: "pb2", redis: REDIS_DB("PB2_REDIS_DB"), cost: 76 },
  "e2e/P-c/playwright.pc.config.ts": { db: "pc", redis: REDIS_DB("PC_REDIS_DB"), cost: 47 },
  "e2e/P-c2/playwright.pc2.config.ts": { db: "pc2", redis: REDIS_DB("PC2_REDIS_DB"), cost: 58 },
  "e2e/P-d/playwright.pd.config.ts": { db: "pd", redis: REDIS_DB("PD_REDIS_DB"), cost: 75 },
  // Mock tools/mocks đọc GITHUB_MOCK_PORT=4040 / KH_MOCK_PORT=4030 từ .env.local: trùng hub của combine / stub của x1.
  "e2e/chat/playwright.config.ts": {
    env: { GITHUB_MOCK_PORT: "4041", KH_MOCK_PORT: "4031" },
    cost: 89,
  },
  "e2e/chat/playwright.x2a.config.ts": { db: "x2a", redis: REDIS_URL("X2A_REDIS_URL"), cost: 44 },
  "e2e/chat/playwright.x2b.config.ts": { db: "x2b", redis: REDIS_URL("X2B_REDIS_URL"), cost: 50 },
  // Cổng Runtime giả mặc định 4059 trùng "sẵn sàng" của x2a (trước đây chạy nối tiếp nên không lộ).
  "e2e/chat/playwright.x2b2.config.ts": {
    db: "x2b2",
    redis: REDIS_URL("X2B_REDIS_URL"),
    env: { CHAT_E2E_RT_PORT: "4079" },
    cost: 34,
  },
  "e2e/combine/playwright.config.ts": {
    db: "combine",
    redis: REDIS_URL("REDIS_TEST_URL"),
    cost: 24,
  },
  "e2e/contracts-web/playwright.config.ts": { cost: 22 },
  "e2e/studio/playwright.config.ts": { cost: 101 },
  "e2e/x1/playwright.config.ts": { db: "x1", cost: 62 },
  "playwright.config.ts": { db: "root", cost: 613 },
};

export const norm = (p: string): string => p.replaceAll("\\", "/");

export function fallbackMeta(config: string): Meta {
  const tag = norm(config)
    .replace(/\.config\.ts$/, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase()
    .slice(0, 18);
  return { db: `x_${tag}`, cost: 60 };
}

/** Tên ngắn của việc: `e2e/P-a/playwright.pa.config.ts` → `P-a`, `e2e/chat/playwright.x2a.config.ts` → `chat-x2a`. */
export function jobSlug(config: string): string {
  const c = norm(config);
  if (c === "playwright.config.ts") return "root";
  const parts = c.replace(/^e2e\//, "").split("/");
  const dir = parts[0] ?? c;
  const m = /^playwright\.(.+)\.config\.ts$/.exec(parts.at(-1) ?? "");
  const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return m?.[1] && !alnum(dir).endsWith(alnum(m[1])) ? `${dir}-${m[1]}` : dir;
}

export type Job = {
  name: string;
  config: string;
  /** Đối số thêm cho Playwright (lọc file spec). */
  files: string[];
  meta: Meta;
  /** Cổng web gốc riêng của việc (chỉ việc `root` ≥ 1); vắng = mặc định của cấu hình. */
  rootPort?: number;
  /** Việc dùng đồng hồ máy chủ giả (spec chờ bước TOTP bằng cách dịch đồng hồ, không ngủ chờ). */
  clock?: boolean;
  cost: number;
};

/** Regex Playwright khớp đúng một file spec ở gốc `e2e/`. */
export const specPattern = (file: string): string =>
  `${norm(file)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("/", "[\\\\/]")}$`;

export type SpecInfo = { file: string; cost: number; pin0: boolean; clock: boolean };

/** Chia spec gốc: file ghim cổng 3000 vào ca 0; file dùng đồng hồ giả riêng một ca; phần còn lại LPT theo thời lượng. */
export function splitRoot(specs: readonly SpecInfo[], shards: number): SpecInfo[][] {
  const clock = specs.filter((s) => s.clock);
  const rest = specs.filter((s) => !s.clock);
  const n = Math.max(1, shards);
  const bins: SpecInfo[][] = Array.from({ length: n }, () => []);
  const load = new Array<number>(n).fill(0);
  const put = (i: number, s: SpecInfo) => {
    (bins[i] as SpecInfo[]).push(s);
    load[i] = (load[i] ?? 0) + s.cost;
  };
  for (const s of rest.filter((x) => x.pin0)) put(0, s);
  const free = rest
    .filter((x) => !x.pin0)
    .sort((a, b) => b.cost - a.cost || a.file.localeCompare(b.file));
  for (const s of free) put(load.indexOf(Math.min(...load)), s);
  return [...bins.filter((b) => b.length), ...(clock.length ? [clock] : [])];
}

const ROOT_PORT0 = 3000;
const ROOT_PORT_STEP = 10;
const ROOT_PORT_BASE = 3400;

/** Việc gốc: một việc mỗi ca; ca 0 giữ cổng 3000/3001 như cũ, ca khác từ 3410 (cổng web; API = web + 1). */
export function rootJobs(specs: readonly SpecInfo[], shards: number, meta: Meta): Job[] {
  return splitRoot(specs, shards).map((files, i) => {
    const clock = files.some((f) => f.clock);
    return {
      name: `root-${clock ? "clock" : i}`,
      config: "playwright.config.ts",
      files: files.map((f) => specPattern(f.file)),
      meta: clock ? { ...meta, db: "root_clock" } : { ...meta, db: i === 0 ? "root" : `root${i}` },
      rootPort: i === 0 ? ROOT_PORT0 : ROOT_PORT_BASE + i * ROOT_PORT_STEP,
      ...(clock ? { clock: true } : {}),
      cost: files.reduce((a, f) => a + f.cost, 0),
    };
  });
}

export type Plan = { configs: readonly string[]; specs: readonly SpecInfo[]; rootShards: number };

/** Danh sách việc, việc nặng trước (LPT). `only`: lọc theo tên việc hoặc đường dẫn cấu hình (tiền tố). */
export function planJobs(p: Plan, timings: Readonly<Record<string, number>>, only?: string): Job[] {
  const jobs: Job[] = [];
  for (const raw of p.configs) {
    const config = norm(raw);
    const meta = { ...(META[config] ?? fallbackMeta(config)) };
    meta.cost = timings[config] ?? meta.cost;
    if (config === "playwright.config.ts") jobs.push(...rootJobs(p.specs, p.rootShards, meta));
    else jobs.push({ name: jobSlug(config), config, files: [], meta, cost: meta.cost });
  }
  // `only`: một hoặc nhiều (ngăn bằng dấu phẩy) tên việc / tiền tố đường dẫn cấu hình.
  const wants = (only ?? "").split(",").filter(Boolean);
  const keep = (j: Job) =>
    !wants.length ||
    wants.some((w) => j.name === w || j.name.startsWith(w) || j.config.startsWith(norm(w)));
  return jobs.filter(keep).sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
}

import { e2eDbTag, portShift, shiftNumericEnv } from "./e2e-lane.rules";

const withDb = (url: string, name: string): string => {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
};

/** DB test riêng của việc (URL của chủ và của `admin_api` giữ user/mật khẩu, chỉ đổi tên DB). */
function dbEnv(
  job: Job,
  base: Readonly<Record<string, string | undefined>>,
  lane = 0,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!job.meta.db) return out;
  const name = `ai_system_${e2eDbTag(lane, job.meta.db)}_test`;
  for (const k of ["TEST_DATABASE_URL", "TEST_ADMIN_API_DATABASE_URL"]) {
    const v = base[k];
    if (v) out[k] = withDb(v, name);
  }
  return out;
}

/** Redis DB đã cấp cho việc, ghi vào đúng biến của cấu hình (`db` ⇒ số, `url` ⇒ URL). */
function redisEnv(
  job: Job,
  base: Readonly<Record<string, string | undefined>>,
  redisDb: number | undefined,
): Record<string, string> {
  const r = job.meta.redis;
  if (!r || redisDb === undefined) return {};
  const url = new URL(base.REDIS_URL ?? "redis://localhost:6379");
  url.pathname = `/${redisDb}`;
  return Object.fromEntries(
    r.vars.map((v) => [v, r.kind === "db" ? String(redisDb) : url.toString()]),
  );
}

/** Trần lượt đăng nhập mỗi IP cho admin-api trong e2e (admin-api chỉ nhận biến này ngoài production). */
export const E2E_LOGIN_IP_MAX = "100000";

/** Biến môi trường riêng của một việc (đè lên `.env.local` vì `loadEnvFile` không ghi đè biến đã có). */
export function jobEnv(
  job: Job,
  base: Readonly<Record<string, string | undefined>>,
  redisDb: number | undefined,
  dir: { dist: string; clockFile: string },
  lane = 0,
): Record<string, string> {
  return {
    E2E_DIST_DIR: dir.dist,
    // T1: mọi việc gọi admin-api từ cùng IP 127.0.0.1 và chung Redis ⇒ trần IP 30/10' (L1) chặn đăng nhập của cả lượt.
    LOGIN_IP_MAX_ATTEMPTS: E2E_LOGIN_IP_MAX,
    ...(job.clock ? { E2E_CLOCK_FILE: dir.clockFile } : {}),
    ...shiftNumericEnv(job.meta.env ?? {}, lane),
    ...dbEnv(job, base, lane),
    ...redisEnv(job, base, redisDb),
    ...(job.rootPort !== undefined
      ? { E2E_ROOT_WEB_PORT: String(job.rootPort + portShift(lane)) }
      : {}),
  };
}

/** Số việc chạy cùng lúc: mặc định theo lõi (tối đa số Redis DB e2e), `--jobs=N` ghi đè (1..REDIS_DBS.length). */
export function jobConcurrency(want: number | undefined, cores: number): number {
  const n = want ?? Math.max(2, Math.min(5, Math.floor(cores / 2) - 1));
  if (!Number.isInteger(n) || n < 1 || n > REDIS_DBS.length)
    throw new Error(
      `--jobs phải là số nguyên 1..${REDIS_DBS.length}, nhận ${JSON.stringify(want)}`,
    );
  return n;
}

export type E2eArgs = { jobs?: number; only?: string; shards: number };

export function parseE2eArgs(argv: readonly string[]): E2eArgs {
  const val = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const j = val("jobs");
  const s = val("shards");
  return {
    jobs: j === undefined ? undefined : Number(j),
    only: val("only"),
    shards: s ? Number(s) : 3,
  };
}

/** Tổng kết một việc từ báo cáo JSON của Playwright (`stats` + danh sách ca đỏ). */
export type Report = {
  stats?: { expected?: number; unexpected?: number; flaky?: number; skipped?: number };
  suites?: unknown[];
};

type Spec = { title: string; file: string; tests?: { results?: { duration?: number }[] }[] };
type Suite = { specs?: Spec[]; suites?: Suite[] };

function eachSpec(s: Suite, f: (sp: Spec) => void): void {
  for (const sp of s.specs ?? []) f(sp);
  for (const c of s.suites ?? []) eachSpec(c, f);
}

/** Giây mỗi file spec (tổng `duration` các lần chạy của mọi ca trong file). */
export function fileSeconds(rep: Report): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of (rep.suites ?? []) as Suite[])
    eachSpec(s, (sp) => {
      const ms = (sp.tests ?? [])
        .flatMap((t) => t.results ?? [])
        .reduce((a, r) => a + (r.duration ?? 0), 0);
      out[sp.file] = (out[sp.file] ?? 0) + ms / 1000;
    });
  return out;
}

export function summarize(rep: Report): { pass: number; fail: number; flaky: number } {
  const s = rep.stats ?? {};
  return { pass: s.expected ?? 0, fail: s.unexpected ?? 0, flaky: s.flaky ?? 0 };
}
