// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: kịch bản demo đọc biến môi trường
// CR-125 · cr125-purchase-templates · stack local cho `purchase-templates.ts`: giống `tools/hub-dev/src/uat-stack.ts` (cổng UAT_PORT_BASE,
// mặc định 3800: admin-web = BASE, admin-api +1, hub-api +2, Sổ Hợp Tác (workspace-web) +3) nhưng hub-api chạy "như prod" cho hành trình
// mua hàng: ESIGN_PROVIDERS=selfsign (Ký thử), FileBox GIẢ trong tiến trình (tests/acceptance/FB1/_fbfake) và CLI AI GIẢ trả JSON trích HĐ.
// Chạy nền từ thư mục worktree:  UAT_PORT_BASE=3800 bun --env-file=.env.local tools/demo/purchase-templates-stack.ts  (đợi "PT STACK READY").
// PID ghi ở `.data/pt125-logs/pids.txt` (dừng: Stop-Process theo PID). Dữ liệu giả; không bí mật.
import { mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { startFbFake } from "../../tests/acceptance/FB1/_fbfake";
import { ensureDemoFixture } from "../hub-dev/src/fixture";

const REPO = process.cwd().replaceAll("\\", "/");
const e = process.env as Record<string, string>;
const BASE = Number(e.UAT_PORT_BASE ?? 3800);
const DB = e.UAT_DB ?? "ai_system_pt125_test";
const REDIS_DB = e.UAT_REDIS_DB ?? "13";
const LOG = e.UAT_LOG ?? `${REPO}/.data/pt125-logs`;
mkdirSync(LOG, { recursive: true });
const swap = (u: string) => u.replace(/\/[^/?]+(\?|$)/, `/${DB}$1`);
const API = `http://127.0.0.1:${BASE + 1}`;
const HUB = `http://127.0.0.1:${BASE + 2}`;
const WEB = BASE;
const CW = BASE + 3;

/** CLI Claude GIẢ: in một kết quả `claude -p --output-format json` chứa JSON trích của "hợp đồng" mẫu (Phiếu đề xuất mua). */
function writeFakeClaude(file: string): string {
  const fixture = `${REPO}/e2e/journey-approval/_fixture.ts`;
  const src = `import { buyContract, extractionFor } from ${JSON.stringify(fixture)};
await Bun.stdin.text();
const out = extractionFor(buyContract("pt125", 480000000));
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(out),
  usage: { input_tokens: 100, output_tokens: 50 } }));
`;
  const ts = `${file}.ts`;
  writeFileSync(ts, src);
  const exe = process.platform === "win32" ? `${file}.exe` : file;
  const b = Bun.spawnSync([process.execPath, "build", "--compile", ts, "--outfile", exe]);
  if (b.exitCode !== 0) throw new Error(`build CLI giả: ${b.stderr.toString()}`);
  return exe;
}

const fb = startFbFake();
mkdirSync(`${REPO}/.data/pt125`, { recursive: true });
const cli = writeFakeClaude(`${REPO}/.data/pt125/fake-claude`);
const env: Record<string, string> = {
  ...e,
  DATABASE_URL: swap(e.DATABASE_URL as string),
  ADMIN_API_DATABASE_URL: swap(e.ADMIN_API_DATABASE_URL as string),
  HUB_DATABASE_URL: swap(e.HUB_DATABASE_URL as string),
  REDIS_URL: `redis://localhost:6379/${REDIS_DB}`,
  PORT: String(BASE + 1),
  HUB_PORT: String(BASE + 2),
  HUB_CORS_ORIGINS: `http://localhost:${WEB},http://127.0.0.1:${WEB},http://localhost:${CW}`,
  CORS_ORIGINS: `http://localhost:${WEB},http://127.0.0.1:${WEB},http://localhost:${CW}`,
  APP_ENV: "development",
  HUB_PROCESS_ENGINE: "on",
  CONTRACTS_APPROVAL_ENGINE: "on",
  HUB_SEED_FIXTURES: "1",
  LOGIN_IP_MAX_ATTEMPTS: "100000", // kịch bản đăng nhập nhiều người một IP
  ADMIN_HUB_URL: HUB,
  HUB_BASE_URL: HUB,
  PUBLIC_HUB_URL: HUB,
  HUB_URL: HUB,
  ADMIN_API_URL: API,
  ESIGN_PROVIDERS: "selfsign",
  AI_PROVIDER: "subscription",
  AI_SUB_CLI_PATH: cli,
  HUB_ATTACH_DRIVER: "filebox",
  FILEBOX_URL: fb.origin,
  FILEBOX_ORG: "ai-system",
  FILEBOX_TOKEN: fb.token,
  HUB_PUBLIC_INTERNAL_URL: HUB,
  PUBLIC_STUDIO_URL: "",
};
const kids: Bun.Subprocess[] = [];
const sh = (args: string[], extra: Record<string, string> = {}) => {
  const p = Bun.spawnSync([process.execPath, ...args], {
    cwd: REPO,
    env: { ...env, ...extra },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (p.exitCode) throw new Error(`${args.join(" ")} exit ${p.exitCode}`);
};
const spawn = (args: string[], name: string, extra: Record<string, string> = {}) => {
  const p = Bun.spawn([process.execPath, ...args], {
    cwd: REPO,
    env: { ...env, ...extra },
    stdout: Bun.file(`${LOG}/${name}.log`),
    stderr: Bun.file(`${LOG}/${name}.err.log`),
  });
  kids.push(p);
  return p;
};
const wait = async (u: string, n = 180) => {
  for (let i = 0; i < n; i++) {
    try {
      if ((await fetch(u)).ok) return;
    } catch {}
    await Bun.sleep(1000);
  }
  throw new Error(`timeout ${u}`);
};

const root = postgres(e.DATABASE_URL as string, { max: 1, onnotice: () => {} });
const has = await root`select 1 from pg_database where datname = ${DB}`;
if (has.length === 0) await root.unsafe(`create database ${DB}`);
await root.end();
sh(["packages/db/src/migrate.ts"]);
sh(["packages/db/src/seed.ts"]);
spawn(["apps/admin-api/src/server.ts"], "admin-api");
await wait(`${API}/health`);
await ensureDemoFixture(API);
sh(["apps/hub-api/src/modules/seed/seed.ts"]);
spawn(["apps/hub-api/src/server.ts"], "hub-api");
await wait(`${HUB}/health`);
const ADMIN_ENV = { E2E_DIST_DIR: `dist-pt${BASE}-admin`, PUBLIC_FROZEN_MODULES: "on" };
const CW_ENV = {
  E2E_DIST_DIR: `dist-pt${BASE}-cw`,
  AUTH_URL: API,
  PUBLIC_SSO_URL: "",
  PUBLIC_TENANT_KEY: "",
};
sh(["run", "--filter", "@ai/admin-web", "build"], ADMIN_ENV);
spawn(["run", "--filter", "@ai/admin-web", "preview", "--port", String(WEB)], "web", ADMIN_ENV);
sh(["run", "--filter", "@ai/workspace-web", "build"], CW_ENV);
spawn(["run", "--filter", "@ai/workspace-web", "preview", "--port", String(CW)], "cw", CW_ENV);
await wait(`http://localhost:${WEB}/`);
await wait(`http://localhost:${CW}/`);
await Bun.write(`${LOG}/pids.txt`, [process.pid, ...kids.map((k) => k.pid)].join("\n"));
console.log("PT STACK READY");
await new Promise(() => {});
