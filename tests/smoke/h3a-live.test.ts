// HUB-H3a-AC-12 · WRK-FR-22 · test-plan-py H3a §4 SM1–SM4: smoke probe provider subscription với `claude-sub` thật
// (`HUB_LIVE=1 bun run test:smoke:live`; vắng cờ → mọi ca skip). Không chặn `done:h3a`, không khoá.
// Tự dựng + dọn: DB riêng `ai_system_h3a_smoke_test` (migrate Admin + Hub, chỉ provider `claude-sub`), Redis DB riêng
// (`H3A_REDIS_DB`, mặc định 12, FLUSHDB trước/sau), Runtime WSL (user `worker`) với `HOME` tạm có symlink
// `.claude`/`.claude.json` → thư mục thật (PL10). SM2 đổi symlink sang thư mục rỗng, SM3 trả lại — **không** đụng,
// đổi tên hay chép file credential thật; không gọi `claude auth status`/logout/login trực tiếp; không Hub, không Dify.
// Lượt model thật: 2 lượt haiku (SM1 khởi động, SM3 hồi phục — PL11). Chạy cả file (các ca dùng chung Runtime).
// Env: `TEST_DATABASE_URL` (owner, `.env.local`), `H3A_WSL_DISTRO` (Ubuntu), `H3A_WSL_USER` (worker),
// `H3A_WSL_REPO` (mặc định suy từ ổ đĩa repo: `/mnt/<ổ>/…`), `H3A_REDIS_DB`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { runMigrations } from "@ai/db";
import { runHubMigrations } from "@ai/db/migrate-hub";
import { withDatabase } from "@ai/db/test-db";
import postgres from "postgres";
import { createRedis } from "../../apps/hub-api/src/lib/redis";

const env = (k: string) => process.env[k]?.trim() || undefined;
const LIVE = (env("HUB_LIVE") ?? "0") !== "0";
const DB_NAME = "ai_system_h3a_smoke_test";
const DISTRO = env("H3A_WSL_DISTRO") ?? "Ubuntu";
const WSL_USER = env("H3A_WSL_USER") ?? "worker";
const REDIS_DB = Number(env("H3A_REDIS_DB") ?? "12");
const REPO_WIN = resolve(import.meta.dir, "../..");
const REPO =
  env("H3A_WSL_REPO") ??
  `/mnt/${REPO_WIN[0]?.toLowerCase()}${REPO_WIN.slice(2).replaceAll("\\", "/")}`;
const BASE = "$REAL/smoke-h3a"; // trong WSL, `$REAL` = HOME thật của user
const BASE_URL = env("TEST_DATABASE_URL") ?? "";
const OWNER_URL = BASE_URL ? withDatabase(BASE_URL, DB_NAME) : "";
const RT_URL = (() => {
  if (!OWNER_URL) return "";
  const u = new URL(OWNER_URL);
  u.username = "agent_runtime";
  u.password = "agent_runtime_dev_pw";
  return u.toString();
})();

// ---------- WSL ----------
function wsl(script: string): { code: number; out: string } {
  const p = Bun.spawnSync(["wsl.exe", "-d", DISTRO, "-u", WSL_USER, "--", "bash", "-l", "-s"], {
    stdin: new TextEncoder().encode(`REAL=$HOME\n${script}\n`),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode ?? 1, out: p.stdout.toString().trim() };
}

/** Symlink trong HOME tạm: `real` → thư mục thật, `empty` → thư mục rỗng/đường không tồn tại (PL10). */
function link(to: "real" | "empty"): void {
  const dir = to === "real" ? "$REAL/.claude" : `${BASE}/empty/claude-dir`;
  const file = to === "real" ? "$REAL/.claude.json" : `${BASE}/empty/claude.json`;
  const r = wsl(
    `ln -sfn "${dir}" "${BASE}/home/.claude" && ln -sfn "${file}" "${BASE}/home/.claude.json"`,
  );
  expect(r.code).toBe(0);
}

const RT_SCRIPT = () => `set -e
rm -rf "${BASE}"; mkdir -p "${BASE}/home" "${BASE}/empty/claude-dir" "${BASE}/work" "${BASE}/logs"
ln -sfn "$REAL/.claude" "${BASE}/home/.claude"; ln -sfn "$REAL/.claude.json" "${BASE}/home/.claude.json"
cd "${REPO}/apps/agent-runtime"
export VIRTUAL_ENV="$REAL/.venvs/agent-runtime" HOME="${BASE}/home" APP_ENV=development LOG_LEVEL=debug
export PATH="$VIRTUAL_ENV/bin:/usr/local/bin:/usr/bin:/bin" AGENT_RT_PROVIDERS=claude-sub
export AGENT_RT_DATABASE_URL='${RT_URL}' REDIS_URL='redis://localhost:6379/${REDIS_DB}'
export AGENT_RT_WORKER_ID=smoke-h3a AGENT_RT_WORK_DIR="${BASE}/work" AGENT_RT_LOG_DIR="${BASE}/logs"
export AGENT_RT_PROBE_S=1200 AGENT_RT_PROBE_LOGGED_OUT_S=5
echo $$ > "${BASE}/pid"
exec "$VIRTUAL_ENV/bin/python" -m agent_runtime 2>&1`;

// ---------- Runtime + log ----------
type Line = Record<string, unknown> & { event?: string; t: number };
const raw: string[] = [];
const lines: Line[] = [];
let rt: ReturnType<typeof Bun.spawn> | undefined;
let t0 = 0;

async function pump(stream: ReadableStream<Uint8Array>): Promise<void> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += dec.decode(chunk, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const s of parts.map((x) => x.trim()).filter(Boolean)) {
      raw.push(s);
      try {
        lines.push({
          ...(JSON.parse(s) as Record<string, unknown>),
          t: Math.round(performance.now() - t0),
        });
      } catch {
        lines.push({ event: "(raw)", t: Math.round(performance.now() - t0) });
      }
    }
  }
}

const since = (n: number, ev: string) => lines.slice(n).filter((l) => l.event === ev);
const pid = () => wsl(`cat "${BASE}/pid" && kill -0 "$(cat "${BASE}/pid")" && echo alive`).out;

async function until<V>(ms: number, f: () => Promise<V | undefined>): Promise<V> {
  const end = performance.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== undefined) return v;
    if (performance.now() > end) throw new Error(`hết hạn ${ms} ms`);
    await Bun.sleep(500);
  }
}

// ---------- DB ----------
type State = {
  status: string;
  last_probe_at: Date | null;
  rate_limit_type: string | null;
  utilization: string | null;
};
let sql: postgres.Sql | undefined;
const state = async (): Promise<State | undefined> =>
  (
    await (sql as postgres.Sql)<
      State[]
    >`select status, last_probe_at, rate_limit_type, utilization::text
      from hub.provider_state where provider_key = 'claude-sub'`
  )[0];

async function dbUp(): Promise<void> {
  const m = postgres(withDatabase(OWNER_URL, "postgres"), { max: 1, onnotice: () => {} });
  try {
    await m.unsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    await m.unsafe(`CREATE DATABASE "${DB_NAME}"`);
  } finally {
    await m.end();
  }
  await runMigrations({ url: OWNER_URL, appEnv: "test" });
  await runHubMigrations({ url: OWNER_URL, appEnv: "test" });
  sql = postgres(OWNER_URL, { max: 2, onnotice: () => {} });
  await sql`insert into hub.providers (key, kind, vendor, max_concurrency, enabled, dev_only)
    values ('claude-sub', 'subscription', 'anthropic', 1, true, false)`;
}

async function flushRedis(): Promise<void> {
  const r = createRedis(`redis://localhost:6379/${REDIS_DB}`);
  await r.connect();
  await r.flushdb();
  r.disconnect();
}

async function cleanup(): Promise<void> {
  wsl(`[ -f "${BASE}/pid" ] && kill -TERM "$(cat "${BASE}/pid")" 2>/dev/null; true`);
  await rt?.exited.catch(() => undefined);
  wsl(`rm -rf "${BASE}"`); // chỉ thư mục tạm: symlink bị xoá, đích thật không bị đụng
  await sql?.end();
  const m = postgres(withDatabase(OWNER_URL, "postgres"), { max: 1, onnotice: () => {} });
  await m.unsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`).finally(() => m.end());
  await flushRedis();
}

const fmt = (l: Line | undefined) =>
  l
    ? Object.entries(l)
        .filter(([k]) => !["ts", "worker_id", "level"].includes(k))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ")
    : "-";

let pid0 = "";

async function startRuntime(): Promise<void> {
  expect(BASE_URL).not.toBe("");
  await dbUp();
  await flushRedis();
  t0 = performance.now();
  rt = Bun.spawn(["wsl.exe", "-d", DISTRO, "-u", WSL_USER, "--", "bash", "-l", "-s"], {
    stdin: new TextEncoder().encode(`REAL=$HOME\n${RT_SCRIPT()}\n`),
    stdout: "pipe",
    stderr: "pipe",
  });
  void pump(rt.stdout as ReadableStream<Uint8Array>);
  void pump(rt.stderr as ReadableStream<Uint8Array>);
}

const logDb = (tag: string, s: State | undefined) =>
  console.log(
    `[smoke] ${tag} db status=${s?.status} type=${s?.rate_limit_type} util=${s?.utilization}`,
  );

async function sm1(): Promise<void> {
  const res = await until(60_000, async () => since(0, "probe.result")[0]);
  const s = await until(10_000, async () =>
    (await state())?.status === "ok" ? state() : undefined,
  );
  const rl = since(0, "claude.rate_limit")[0];
  console.log(`[smoke] SM1 ready@${since(0, "runtime.ready")[0]?.t}ms ${fmt(res)} ${fmt(rl)}`);
  logDb("SM1", s);
  expect(res.outcome).toBe("ok");
  expect(res.step).toBe("turn");
  expect(Number(res.ms)).toBeGreaterThan(0);
  expect(Number(res.input_tokens)).toBeGreaterThan(0);
  expect(s?.last_probe_at).not.toBeNull();
  pid0 = pid();
  expect(pid0).toContain("alive");
}

async function sm2(): Promise<void> {
  const n = lines.length;
  link("empty");
  // R12: provider vừa probe `ok` ⇒ lượt kế sau AGENT_RT_PROBE_S; lùi mốc để nhịp kế (≤ 5 s) probe ngay.
  await (sql as postgres.Sql)`update hub.provider_state set last_probe_at = now() - interval '2 hours',
    last_ok_at = now() - interval '2 hours' where provider_key = 'claude-sub'`;
  const t = performance.now();
  const ev = await until(30_000, async () => since(n, "provider.logged_out")[0]);
  const ms = Math.round(performance.now() - t);
  const results = since(n, "probe.result");
  const each = results.map((r) => r.ms).join(",");
  console.log(`[smoke] SM2 logged_out sau ${ms}ms ${fmt(results[0])} (lượt (a): ${each})`);
  expect((await state())?.status).toBe("logged_out");
  expect(ev.source).toBe("probe");
  expect(results.every((r) => r.step === "auth" && Number(r.input_tokens) === 0)).toBe(true);
}

async function sm3(): Promise<void> {
  await Bun.sleep(6_000); // ≥ 1 vòng `logged_out` nữa chỉ (a) — bằng chứng (a) không gọi model
  const n = lines.length;
  const t = performance.now();
  link("real");
  const ev = await until(60_000, async () => since(n, "provider.recovered")[0]);
  const ms = Math.round(performance.now() - t);
  const res = since(n, "probe.result").find((r) => r.outcome === "ok");
  const s = await state();
  console.log(
    `[smoke] SM3 recovered sau ${ms}ms ${fmt(ev)} ${fmt(res)} ${fmt(since(n, "claude.rate_limit")[0])}`,
  );
  logDb("SM3", s);
  expect(s?.status).toBe("ok");
  expect(ev.from).toBe("logged_out");
  expect(res?.step).toBe("turn");
  expect(pid()).toBe(pid0);
  expect(since(0, "runtime.ready").length).toBe(1);
  const turns = lines.filter((l) => l.event === "probe.result" && l.step === "turn").length;
  console.log(`[smoke] lượt model thật (probe step=turn) = ${turns}`);
  expect(turns).toBe(2);
}

const LEAKS = [
  /organization/i,
  /orgId/i,
  /accessToken/i,
  /refreshToken/i,
  /Reply/,
  /[\w.+-]+@[\w-]+\.[\w.-]+/,
];

function sm4(): void {
  const all = raw.join("\n");
  for (const bad of LEAKS) expect(all).not.toMatch(bad);
  const probeLines = raw.filter((s) => /"event": ?"(probe|provider|claude)\./.test(s));
  expect(probeLines.length).toBeGreaterThan(0);
  for (const s of probeLines) expect(s).not.toContain("@");
  const warn = lines
    .filter((l) => l.level === "warning" || l.level === "error")
    .map((l) => l.event);
  console.log(`[smoke] SM4 ${raw.length} dòng log, warn/error: ${JSON.stringify(warn)}`);
}

describe.skipIf(!LIVE)("H3a smoke · probe claude-sub thật [HUB-H3a-AC-12] [WRK-FR-22]", () => {
  beforeAll(startRuntime, 120_000);
  afterAll(async () => {
    try {
      link("real"); // `finally`: luôn trả symlink trước khi dừng
    } finally {
      await cleanup();
    }
  }, 120_000);

  it(
    "SM1 · khởi động Runtime → ≤ 60 s status=ok, last_probe_at ≠ NULL, probe.result{step:turn} có ms + token",
    sm1,
    90_000,
  );
  it(
    "SM2 · symlink → thư mục rỗng → ≤ 30 s logged_out + provider.logged_out, chỉ (a)",
    sm2,
    60_000,
  );
  it(
    "SM3 · trả symlink → ≤ 60 s ok + provider.recovered (PL11: 1 lượt (b)), cùng pid Runtime",
    sm3,
    90_000,
  );
  it("SM4 · quét log SM1–SM3 — không email, orgId, organization, token xác thực, prompt", sm4);
});
