// Dựng stack UAT riêng (cổng 35xx, DB `ai_system_uat122_test`, Redis db 12) để agent UI chụp màn hình thật. Không in secret.
// Chạy nền từ thư mục worktree:  bun --env-file=.env.local tools/hub-dev/src/uat-stack.ts   (đợi dòng "UAT STACK READY").
// Web http://localhost:3500 · admin-api :3501 · hub-api :3502 · log trong .data/uat122-logs · PID ở pids.txt (tắt: Stop-Process theo PID).
import { mkdirSync } from "node:fs";
import postgres from "postgres";
import { ensureDemoFixture } from "./fixture";

const REPO = process.cwd().replaceAll("\\", "/");
const e = process.env as Record<string, string>;
// Cổng / DB / Redis chỉnh được để nhiều stack UAT chạy cùng lúc không đụng nhau: UAT_PORT_BASE (web; admin-api +1, hub-api +2), UAT_DB, UAT_REDIS_DB.
const BASE = Number(e.UAT_PORT_BASE ?? 3500);
const DB = e.UAT_DB ?? "ai_system_uat122_test";
const REDIS_DB = e.UAT_REDIS_DB ?? "12";
const LOG = e.UAT_LOG ?? `${REPO}/.data/uat122-logs`;
mkdirSync(LOG, { recursive: true });
const swap = (u: string) => u.replace(/\/[^/?]+(\?|$)/, `/${DB}$1`);
const API = `http://127.0.0.1:${BASE + 1}`;
const HUB = `http://127.0.0.1:${BASE + 2}`;
const WEB = BASE;
const env: Record<string, string> = {
  ...e,
  DATABASE_URL: swap(e.DATABASE_URL as string),
  ADMIN_API_DATABASE_URL: swap(e.ADMIN_API_DATABASE_URL as string),
  HUB_DATABASE_URL: swap(e.HUB_DATABASE_URL as string),
  REDIS_URL: `redis://localhost:6379/${REDIS_DB}`,
  PORT: String(BASE + 1),
  HUB_PORT: String(BASE + 2),
  HUB_CORS_ORIGINS: `http://localhost:${WEB},http://127.0.0.1:${WEB}`,
  CORS_ORIGINS: `http://localhost:${WEB},http://127.0.0.1:${WEB}`,
  APP_ENV: "development",
  HUB_PROCESS_ENGINE: "on",
  HUB_SEED_FIXTURES: "1",
  ADMIN_HUB_URL: HUB,
  HUB_BASE_URL: HUB,
  PUBLIC_HUB_URL: HUB,
  HUB_URL: HUB,
  ADMIN_API_URL: API,
  HUB_ATTACH_DRIVER: "local",
  HUB_ATTACH_DIR: `${REPO}/.data/uat122-attach`,
  HUB_PUBLIC_INTERNAL_URL: HUB,
  PUBLIC_STUDIO_URL: "",
  E2E_DIST_DIR: e.E2E_DIST_DIR ?? `dist-uat${BASE}`,
};
const kids: Bun.Subprocess[] = [];
const sh = (args: string[]) => {
  const p = Bun.spawnSync([process.execPath, ...args], {
    cwd: REPO,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (p.exitCode) throw new Error(`${args.join(" ")} exit ${p.exitCode}`);
};
const spawn = (args: string[], name: string) => {
  const p = Bun.spawn([process.execPath, ...args], {
    cwd: REPO,
    env,
    stdout: Bun.file(`${LOG}/${name}.log`),
    stderr: Bun.file(`${LOG}/${name}.err.log`),
  });
  kids.push(p);
  return p;
};
const wait = async (u: string, n = 120) => {
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
sh(["run", "--filter", "@ai/admin-web", "build"]);
spawn(["run", "--filter", "@ai/admin-web", "preview", "--port", String(WEB)], "web");
await wait(`http://localhost:${WEB}/`);
await Bun.write(`${LOG}/pids.txt`, [process.pid, ...kids.map((k) => k.pid)].join("\n"));
console.log("UAT STACK READY");
await new Promise(() => {});
