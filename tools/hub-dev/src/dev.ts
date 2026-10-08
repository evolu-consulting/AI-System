// HUB-H1-AC-01 · spec H1 §7, §9 Q2/Q3/Q5 · `bun run hub:dev`: dựng môi trường dev Hub trên DB `ai_system`
// (compose): migrate → admin-api (:3001, dùng lại nếu đang chạy) → user fixture → `hub:seed` → hub-api (:4000)
// (`HUB_MAX_CONCURRENT_RUNS` mặc định 20, `HUB_ATTACH_*` thư mục tạm mỗi lần — `hubApiEnv`) → agent-runtime (`fake-cli`; Windows: container Linux như
// `tests/acceptance/H1/stack/_stack.ts`, Linux/WSL2: `uv` thẳng).
// Runtime → Hub (H2c I1, như harness H2a/H2c): `AGENT_RT_HUB_URL` (tải file đính kèm, credential) và `HUB_PUBLIC_INTERNAL_URL`
// (`<url>/mcp` trong payload job) = `hubUrlForRuntime`: container ⇒ `http://host.docker.internal:4000` + `--add-host
// host.docker.internal:host-gateway`; tiến trình thường ⇒ `http://localhost:4000`. TC-4 H2a: chỉ container dùng tên này
// (hosts Windows có thể trỏ sai cho tiến trình trên host) — hub-api trên host không gọi URL này.
// `HUB_DEV_RUNTIME=none` bỏ bước Runtime (tự chạy trong WSL với `claude-sub`, docs/guides/hub-dev.md).
// Ctrl+C dừng những gì script này đã bật. Env đọc từ `.env.local` (script gọi bằng `bun --env-file=.env.local`).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dockerArgs } from "../../../apps/agent-runtime/scripts/run";
import { contractUsersJson, ensureContractFixture, ensureDemoFixture } from "./fixture";
import { ensureRoomAgents } from "./fixture-agents";
import { ensureDemoRooms, ensureFixtureRooms } from "./fixture-rooms";

export const REPO = resolve(import.meta.dir, "../../..");
export const HUB_URL = "http://localhost:4000";
export const AUTH_URL = "http://localhost:3001";
export const HUB_PORT = "4000";
/** Tên host của máy chủ nhìn từ container (Docker Desktop / WSL2), kèm `--add-host …:host-gateway`. */
export const HOST_ALIAS = "host.docker.internal";
const RT_CONTAINER = "ai-hub-dev-runtime";
const RT_DB_DEFAULT = "postgres://agent_runtime:agent_runtime_dev_pw@localhost:5432/ai_system";

type Stop = () => Promise<void> | void;
export type HubDev = { stop: () => Promise<void>; notes: string[] };

export async function healthy(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2_000) });
    await res.body?.cancel();
    return res.status === 200;
  } catch {
    return false;
  }
}

async function waitHealthy(base: string, ms: number, proc?: Bun.Subprocess): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await healthy(base)) return true;
    if (proc && proc.exitCode !== null) return false;
    await Bun.sleep(500);
  }
  return false;
}

function bunRun(args: string[], env: Record<string, string> = {}): number {
  const p = Bun.spawnSync([process.execPath, "--env-file=.env.local", ...args], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  return p.exitCode ?? 1;
}

/** Process nền (log ra console có tiền tố), chờ `/health` 200. */
async function startServer(name: string, file: string, base: string, env: Record<string, string>) {
  const proc = Bun.spawn([process.execPath, "--env-file=.env.local", file], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!(await waitHealthy(base, 30_000, proc))) {
    proc.kill();
    throw new Error(`${name} không khởi động được (exit=${proc.exitCode})`);
  }
  return async () => {
    proc.kill();
    await proc.exited;
  };
}

/** URL cho process trong container: host = tên service compose, cổng nội bộ. */
function inNet(url: string, host: string, port: number): string {
  const u = new URL(url);
  u.hostname = host;
  u.port = String(port);
  return u.toString();
}

/** Runtime chạy ở đâu: `none` (`HUB_DEV_RUNTIME=none`, tự chạy ngoài — WSL mirrored ⇒ `localhost`), `local` (Linux/WSL2),
 * `container` (còn lại). */
export type RuntimeMode = "none" | "local" | "container";
export function runtimeMode(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): RuntimeMode {
  if (env.HUB_DEV_RUNTIME === "none") return "none";
  return platform === "linux" ? "local" : "container";
}

/** URL Hub mà Runtime (và CLI/MCP trong nó) gọi được. */
export function hubUrlForRuntime(inContainer: boolean): string {
  return inContainer ? `http://${HOST_ALIAS}:${HUB_PORT}` : `http://localhost:${HUB_PORT}`;
}

export function runtimeEnv(inContainer: boolean): Record<string, string> {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: env Runtime chỉ của script dev, không ảnh hưởng cache turbo
  const db = process.env.AGENT_RT_DATABASE_URL || RT_DB_DEFAULT;
  const redis = process.env.REDIS_URL || "redis://localhost:6379";
  return {
    APP_ENV: "development",
    AGENT_RT_DATABASE_URL: inContainer ? inNet(db, "postgres", 5432) : db,
    REDIS_URL: inContainer ? inNet(redis, "redis", 6379) : redis,
    AGENT_RT_HUB_URL: hubUrlForRuntime(inContainer),
    AGENT_RT_WORKER_ID: "hub-dev",
    AGENT_RT_PROVIDERS: "fake-cli",
    AGENT_RT_WORK_DIR: "/tmp/hub-dev-work",
    AGENT_RT_LOG_DIR: "/tmp/hub-dev-logs",
  };
}

/** Runtime trong container (Windows/macOS): chờ log `runtime.start` ≤ 120 s. */
async function startRuntimeContainer(): Promise<Stop> {
  const docker = (args: string[]) =>
    Bun.spawnSync(["docker", ...args], { env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  docker(["rm", "-f", RT_CONTAINER]);
  const env = { ...runtimeEnv(true), HOME: "/tmp/hub-dev-home" };
  const cmd = [
    "mkdir -p /tmp/hub-dev-home /tmp/hub-dev-work /tmp/hub-dev-logs",
    "(uv sync --frozen 2>/dev/null || uv sync) >/dev/null 2>&1",
    "exec /opt/venv/bin/python -m agent_runtime",
  ].join("; ");
  const args = dockerArgs(REPO.split("\\").join("/"), cmd);
  const extra = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  args.splice(
    1,
    0,
    "-d",
    "--name",
    RT_CONTAINER,
    "--add-host",
    `${HOST_ALIAS}:host-gateway`,
    ...extra,
  );
  const r = docker(args);
  if (r.exitCode !== 0) throw new Error(`docker run lỗi: ${r.stderr.toString().slice(0, 400)}`);
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const l = docker(["logs", RT_CONTAINER]);
    const logs = l.stdout.toString() + l.stderr.toString();
    if (logs.includes("runtime.start")) return () => void docker(["rm", "-f", RT_CONTAINER]);
    if (logs.includes("runtime.config_invalid")) break;
    await Bun.sleep(1_000);
  }
  docker(["rm", "-f", RT_CONTAINER]);
  throw new Error("agent-runtime (container) không khởi động được — xem `docker logs`");
}

/** Linux/WSL2 (Q5 mirrored): `uv run python -m agent_runtime` trực tiếp, `localhost`. */
async function startRuntimeLocal(): Promise<Stop> {
  const proc = Bun.spawn(["uv", "run", "python", "-m", "agent_runtime"], {
    cwd: resolve(REPO, "apps/agent-runtime"),
    env: { ...runtimeEnv(false), PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    stdout: "inherit",
    stderr: "inherit",
  });
  await Bun.sleep(3_000);
  if (proc.exitCode !== null) throw new Error(`agent-runtime thoát sớm (exit=${proc.exitCode})`);
  return async () => {
    proc.kill();
    await proc.exited;
  };
}

/** admin-api: dùng lại nếu `:3001` đã chạy; lỗi → ghi chú, không chặn (Q2). */
async function adminStep(stops: Stop[], notes: string[]): Promise<boolean> {
  if (await healthy(AUTH_URL)) return true;
  try {
    stops.push(await startServer("admin-api", "apps/admin-api/src/server.ts", AUTH_URL, {}));
    return true;
  } catch (err) {
    notes.push(`admin-api: ${(err as Error).message} — bỏ qua user fixture`);
    return false;
  }
}

async function fixtureStep(notes: string[], contract: boolean): Promise<void> {
  try {
    if (contract) await ensureContractFixture(AUTH_URL);
  } catch (err) {
    notes.push(`user fixture: ${(err as Error).message}`);
  }
  try {
    await ensureDemoFixture(AUTH_URL);
  } catch (err) {
    notes.push(`demo fixture evolu: ${(err as Error).message}`);
  }
}

/** Phòng mẫu (X2a B8) sau `db:migrate` + user fixture; ghi trực tiếp DB bằng `DATABASE_URL` (owner). */
async function roomsStep(notes: string[], contract: boolean): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return void notes.push("phòng mẫu: thiếu DATABASE_URL — bỏ qua");
  try {
    if (contract) await ensureFixtureRooms(url);
    if (!(await ensureDemoRooms(url))) notes.push("phòng mẫu evolu: chưa có tenant — bỏ qua");
  } catch (err) {
    notes.push(`phòng mẫu: ${(err as Error).message}`);
  }
}

/** Agent demo evolu (CR-051: Evolu Consultant + Invoices, mọi user evolu) — sau `hub:seed` (cần profile + `assistant`). */
async function agentsStep(notes: string[]): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return void notes.push("agent phòng: thiếu DATABASE_URL — bỏ qua");
  try {
    if (!(await ensureRoomAgents(url)))
      notes.push("agent phòng evolu: chưa có tenant/profile — bỏ qua");
  } catch (err) {
    notes.push(`agent phòng: ${(err as Error).message}`);
  }
}

/** Giới hạn run đồng thời/user cho hub-dev (H2b plan §2.1, K4b): mặc định 20 để bộ 41 ca contract chat (có run chạy dở)
 * không chạm 429; ghi đè bằng env `HUB_MAX_CONCURRENT_RUNS`. Stack H2b đặt 2 tường minh (`test:h2b:stack`, L6). */
export const HUB_DEV_MAX_CONCURRENT_RUNS = "20";

/** Env hub-api của hub-dev. H2c (plan §7, MK): `HUB_ATTACH_DRIVER=local`; `HUB_ATTACH_DIR` = env (tuyệt đối) nếu
 * có, không thì `attachDir` (thư mục tạm mỗi lần `startHubDev`, xoá khi dừng). Hạn mức/sweeper: mặc định của Hub.
 * `HUB_PUBLIC_INTERNAL_URL` = `hubUrlForRuntime` theo `runtime` (I1 — ghi đè `.env.local`, vì hub-dev quyết định topo). */
export function hubApiEnv(
  env: Record<string, string | undefined> = process.env,
  attachDir?: string,
  runtime: RuntimeMode = "local",
): Record<string, string> {
  const dir = env.HUB_ATTACH_DIR?.trim() || attachDir;
  return {
    APP_ENV: "development",
    HUB_PORT,
    // `none` (Runtime tự chạy ngoài, vd WSL NAT): tôn trọng env nếu có; còn lại hub-dev quyết định topo.
    HUB_PUBLIC_INTERNAL_URL:
      (runtime === "none" && env.HUB_PUBLIC_INTERNAL_URL?.trim()) ||
      hubUrlForRuntime(runtime === "container"),
    HUB_MAX_CONCURRENT_RUNS: env.HUB_MAX_CONCURRENT_RUNS?.trim() || HUB_DEV_MAX_CONCURRENT_RUNS,
    HUB_ATTACH_DRIVER: "local",
    ...(dir ? { HUB_ATTACH_DIR: dir } : {}),
  };
}

/** Thư mục file đính kèm tạm cho một lần hub-dev; `stop` xoá. */
function tempAttachDir(stops: Stop[]): string {
  const dir = mkdtempSync(join(tmpdir(), "hub-dev-attach-"));
  stops.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * CR-051 · tenant `acme`/`beta` + phòng mẫu acme chỉ cho gate/contract test (`done:*` gọi mặc định `contract: true`);
 * `hub:dev`/`combine:dev` chỉ seed platform + evolu, trừ khi `HUB_DEV_CONTRACT_FIXTURE=1`.
 */
export const contractFixtureFromEnv = (env: Record<string, string | undefined> = process.env) =>
  env.HUB_DEV_CONTRACT_FIXTURE === "1";

/** Dựng toàn bộ; trả `stop` cho phần đã bật. Bước hạ tầng hỏng → ném lỗi (đã dừng phần đã bật). */
export async function startHubDev(o: { contract?: boolean } = {}): Promise<HubDev> {
  const contract = o.contract ?? true;
  const stops: Stop[] = [];
  const notes: string[] = [];
  const stop = async () => {
    for (const s of stops.reverse()) await s();
  };
  const mode = runtimeMode();
  try {
    if (bunRun(["packages/db/src/migrate.ts"]) !== 0) throw new Error("db:migrate lỗi");
    if (await adminStep(stops, notes)) await fixtureStep(notes, contract);
    await roomsStep(notes, contract);
    if (bunRun(["apps/hub-api/src/modules/seed/seed.ts"]) !== 0) throw new Error("hub:seed lỗi");
    await agentsStep(notes);
    if (!(await healthy(HUB_URL))) {
      const env = hubApiEnv(process.env, tempAttachDir(stops), mode);
      stops.push(await startServer("hub-api", "apps/hub-api/src/server.ts", HUB_URL, env));
    } else
      notes.push(
        `hub-api :4000 đã chạy sẵn — dùng lại (MCP cần HUB_PUBLIC_INTERNAL_URL=${hubUrlForRuntime(mode === "container")})`,
      );
    if (mode === "none") notes.push("HUB_DEV_RUNTIME=none — không bật agent-runtime");
    else stops.push(mode === "local" ? await startRuntimeLocal() : await startRuntimeContainer());
    return { stop, notes };
  } catch (err) {
    await stop();
    throw err;
  }
}

if (import.meta.main) {
  const contract = contractFixtureFromEnv();
  const dev = await startHubDev({ contract });
  for (const n of dev.notes) console.warn(`[hub-dev] ${n}`);
  console.log(`[hub-dev] sẵn sàng: HUB_URL=${HUB_URL} AUTH_URL=${AUTH_URL}`);
  if (contract) console.log(`[hub-dev] CHAT_CONTRACT_USERS='${contractUsersJson()}'`);
  const quit = async () => {
    await dev.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void quit());
  process.once("SIGTERM", () => void quit());
}
