// e2e-isolation · "làn" (lane) e2e theo checkout: main = làn 0, mỗi worktree một làn 1..MAX_LANE.
// Hàm thuần: cấp làn, suy cổng / tên DB / env-file từ làn, chọn Redis DB, lọc tiến trình cần dọn.
// Phần I/O (file đăng ký, khoá, quét tiến trình) ở `e2e-lane.ts`.
import { delimiter } from "node:path";

/** Mỗi làn dịch cổng +3000 (khoảng cổng mặc định của e2e rộng ~2500: 3000..5500) ⇒ các làn không chồng nhau. */
export const LANE_STEP = 3000;
/** 14 làn: 5500 + 14*3000 = 47500 < 49152 (đầu dải cổng động của Windows). */
export const MAX_LANE = 14;
export const PORT_LO = 3000;
export const PORT_HI = 5500;
/** Cổng Windows dành riêng (CDPSvc) — không bao giờ cấp. */
export const RESERVED_PORTS: readonly number[] = [5040];

export const portShift = (lane: number): number => lane * LANE_STEP;

/** Dải cổng của làn (dùng cho `e2e:reap`). */
export const lanePortRange = (lane: number): [number, number] => [
  PORT_LO + portShift(lane),
  PORT_HI + portShift(lane),
];

/** Mọi biến cổng mà cấu hình e2e đọc, kèm mặc định của làn 0. Làn L ⇒ mặc định + 3000·L. */
export const PORT_VARS: Readonly<Record<string, number>> = {
  FNR_E2E_PORT_BASE: 4700,
  K1_E2E_PORT_BASE: 4800,
  N2_E2E_PORT_BASE: 5340,
  PA_E2E_PORT_BASE: 4500,
  PB_E2E_PORT_BASE: 4600,
  PB2_E2E_PORT_BASE: 4700,
  PC_E2E_PORT_BASE: 4900,
  PC2_E2E_PORT_BASE: 5100,
  PD_E2E_PORT_BASE: 5300,
  CHAT_E2E_HUB_PORT: 4020,
  CHAT_E2E_WEB_PORT: 3100,
  N1_E2E_WEB_PORT: 3300,
  CW_E2E_WEB_PORT: 3310,
  STUDIO_E2E_WEB_PORT: 3200,
  COMMUNITY_E2E_PORT: 3410,
  E2E_ROOT_WEB_PORT: 3000,
};

/** Cấu hình dùng env-file riêng (`<biến>` ⇒ `.env.test-<tag>.local`); làn L>0 thêm hậu tố `_l<L>`. */
export const ENV_FILE_VARS: Readonly<Record<string, { var: string; tag: string }>> = {
  "e2e/fnr-showcase/playwright.fnr.config.ts": { var: "PA_E2E_ENV", tag: "pa_e2e" },
  "e2e/P-a/playwright.pa.config.ts": { var: "PA_E2E_ENV", tag: "pa_e2e" },
  "e2e/K1/playwright.k1.config.ts": { var: "K1_E2E_ENV", tag: "k1_e2e" },
  "e2e/N2/playwright.n2.config.ts": { var: "PD_E2E_ENV", tag: "pd_e2e" },
  "e2e/P-b/playwright.pb.config.ts": { var: "PB_E2E_ENV", tag: "pb_e2e" },
  "e2e/P-b2/playwright.pb2.config.ts": { var: "PB2_E2E_ENV", tag: "pb2_e2e" },
  "e2e/P-c/playwright.pc.config.ts": { var: "PC_E2E_ENV", tag: "pc_e2e" },
  "e2e/P-c2/playwright.pc2.config.ts": { var: "PC2_E2E_ENV", tag: "pc2_e2e" },
  "e2e/P-d/playwright.pd.config.ts": { var: "PD_E2E_ENV", tag: "pd_e2e" },
};

/** Biến Redis DB (số) hoặc URL của cấu hình chạy trực tiếp (mặc định cũ: số cố định, đụng nhau giữa worktree). */
export const REDIS_VARS: Readonly<Record<string, { kind: "db" | "url"; vars: string[] }>> = {
  "e2e/fnr-showcase/playwright.fnr.config.ts": { kind: "db", vars: ["PA_REDIS_DB"] },
  "e2e/K1/playwright.k1.config.ts": { kind: "db", vars: ["K1_REDIS_DB"] },
  "e2e/N2/playwright.n2.config.ts": { kind: "db", vars: ["N2_REDIS_DB"] },
  "e2e/P-a/playwright.pa.config.ts": { kind: "db", vars: ["PA_REDIS_DB"] },
  "e2e/P-b/playwright.pb.config.ts": { kind: "db", vars: ["PB_REDIS_DB"] },
  "e2e/P-b2/playwright.pb2.config.ts": { kind: "db", vars: ["PB2_REDIS_DB"] },
  "e2e/P-c/playwright.pc.config.ts": { kind: "db", vars: ["PC_REDIS_DB"] },
  "e2e/P-c2/playwright.pc2.config.ts": { kind: "db", vars: ["PC2_REDIS_DB"] },
  "e2e/P-d/playwright.pd.config.ts": { kind: "db", vars: ["PD_REDIS_DB"] },
  "e2e/chat/playwright.x2a.config.ts": { kind: "url", vars: ["X2A_REDIS_URL"] },
  "e2e/chat/playwright.x2b.config.ts": { kind: "url", vars: ["X2B_REDIS_URL"] },
  "e2e/chat/playwright.x2b2.config.ts": { kind: "url", vars: ["X2B_REDIS_URL"] },
  "e2e/combine/playwright.config.ts": { kind: "url", vars: ["REDIS_TEST_URL"] },
};

/** Redis chỉ có 16 DB; 0 = dev, 1..6 = test:int:par, 7..15 = e2e (cấp phát bằng hợp đồng thuê toàn máy, không chia theo làn). */
export const REDIS_POOL: readonly number[] = [7, 8, 9, 10, 11, 12, 13, 14, 15];

export const LOGIN_IP_MAX = "100000";

type Env = Readonly<Record<string, string | undefined>>;

const isSet = (env: Env, k: string): boolean => (env[k] ?? "") !== "";

/** Env cổng của làn (chỉ biến chưa được đặt tay). Làn 0 ⇒ để mặc định của cấu hình, chỉ ghi `E2E_PORT_SHIFT=0`. */
export function lanePortEnv(lane: number, env: Env = {}): Record<string, string> {
  const shift = portShift(lane);
  const out: Record<string, string> = { E2E_PORT_SHIFT: String(shift) };
  if (lane === 0) return out;
  for (const [k, d] of Object.entries(PORT_VARS)) if (!isSet(env, k)) out[k] = String(d + shift);
  return out;
}

/** Cộng dịch cổng vào các giá trị số của env cố định của một việc (mock GITHUB_MOCK_PORT=4041…). */
export function shiftNumericEnv(
  e: Readonly<Record<string, string>>,
  lane: number,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(e).map(([k, v]) => [
      k,
      /^\d+$/.test(v) ? String(Number(v) + portShift(lane)) : v,
    ]),
  );
}

/** Tag DB test theo làn: làn 0 giữ nguyên, làn L ⇒ `<tag>_l<L>`. */
export const laneTag = (lane: number, tag: string): string =>
  lane === 0 ? tag : `${tag}_l${lane}`;

/** Tag DB của `test-db-cli` (^[a-z0-9_]{1,24}$) cho việc e2e: `e2e_<db>` (+ hậu tố làn); quá dài ⇒ cắt + băm 4 ký tự để không trùng. */
export function e2eDbTag(lane: number, db: string): string {
  const full = `e2e_${laneTag(lane, db)}`;
  if (full.length <= 24) return full;
  let h = 0;
  for (const c of full) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${full.slice(0, 19)}_${h.toString(36).padStart(4, "0").slice(-4)}`;
}

/** Env-file theo làn cho cấu hình chạy trực tiếp; null = cấu hình không dùng env-file riêng. */
export function laneEnvFile(
  lane: number,
  config: string,
): { var: string; tag: string; file: string } | null {
  const m = ENV_FILE_VARS[config.replaceAll("\\", "/")];
  if (!m) return null;
  const tag = laneTag(lane, m.tag);
  return { var: m.var, tag, file: `.env.test-${tag}.local` };
}

export type Registry = Record<string, number>;
const key = (p: string): string => p.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();

export type Alloc = { lane: number; registry: Registry };

/** Cấp làn cho `path`: giữ làn cũ nếu còn, main = 0, còn lại thấp nhất còn trống; bỏ mục có đường dẫn không còn tồn tại. */
export function allocateLane(
  reg: Registry,
  path: string,
  opts: { isMain: boolean; exists: (p: string) => boolean },
): Alloc {
  const registry = pruneRegistry(reg, opts.exists, path);
  const k = key(path);
  if (opts.isMain) return { lane: 0, registry: { ...registry, [k]: 0 } };
  const have = registry[k];
  if (have !== undefined && have > 0) return { lane: have, registry };
  const used = new Set(Object.values(registry));
  for (let l = 1; l <= MAX_LANE; l++)
    if (!used.has(l)) return { lane: l, registry: { ...registry, [k]: l } };
  throw new Error(
    `hết làn e2e (${MAX_LANE}); chạy \`bun run e2e:lanes --prune\` hoặc gỡ worktree cũ`,
  );
}

/** Bỏ các mục có đường dẫn không còn (trừ `keep`). */
export function pruneRegistry(
  reg: Registry,
  exists: (p: string) => boolean,
  keep?: string,
): Registry {
  const kk = keep ? key(keep) : "";
  return Object.fromEntries(Object.entries(reg).filter(([p]) => p === kk || exists(p)));
}

/** Redis DB nhỏ nhất trong pool chưa bị thuê; undefined = hết (người gọi phải chờ). */
export const pickRedisDb = (held: ReadonlySet<number>): number | undefined =>
  REDIS_POOL.find((d) => !held.has(d));

/** Hợp đồng thuê Redis DB thừa nếu chủ đã chết. */
export const leaseStale = (ownerPid: number, alive: (pid: number) => boolean): boolean =>
  !alive(ownerPid);

/** Gán Redis DB vào đúng biến của cấu hình (`db` ⇒ số, `url` ⇒ URL theo `REDIS_URL` gốc). */
export function redisEnvFor(config: string, db: number, baseUrl: string): Record<string, string> {
  const r = REDIS_VARS[config.replaceAll("\\", "/")];
  if (!r) return {};
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return Object.fromEntries(r.vars.map((v) => [v, r.kind === "db" ? String(db) : u.toString()]));
}

export type Proc = { pid: number; ppid: number; name: string; cmd: string };
export type Listen = { pid: number; port: number };

const norm = (s: string): string => s.replaceAll("\\", "/").toLowerCase();

/** `e2e:reap`: chỉ bun/node có dòng lệnh chứa đúng đường dẫn checkout này VÀ đang nghe cổng trong dải làn. */
export function reapTargets(
  procs: readonly Proc[],
  listen: readonly Listen[],
  root: string,
  lane: number,
  self: number,
): number[] {
  const r = `${norm(root).replace(/\/+$/, "")}/`;
  const [lo, hi] = lanePortRange(lane);
  const ports = new Set(listen.filter((l) => l.port >= lo && l.port <= hi).map((l) => l.pid));
  return procs
    .filter(
      (p) =>
        p.pid !== self &&
        /^(bun|node)(\.exe)?$/i.test(p.name) &&
        norm(p.cmd).includes(r) &&
        ports.has(p.pid),
    )
    .map((p) => p.pid);
}

/** Cây con của `root` (không gồm `root`), con trước cha sau để giết từ lá lên. */
export function descendants(procs: readonly Proc[], root: number): number[] {
  const out: number[] = [];
  const walk = (pid: number, seen: Set<number>) => {
    for (const p of procs)
      if (p.ppid === pid && !seen.has(p.pid)) {
        seen.add(p.pid);
        walk(p.pid, seen);
        out.push(p.pid);
      }
  };
  walk(root, new Set([root]));
  return out;
}

/** `PATH` không cần ở đây; tách dấu ngăn để test không phụ thuộc OS. */
export const PATH_DELIM = delimiter;
