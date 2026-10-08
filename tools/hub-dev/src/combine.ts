// X1 ST1 · `bun run combine:dev` (plan-stack.md, plan §3): compose → `startHubDev` (HUB_DEV_RUNTIME=none: migrate →
// admin-api :3001 → user fixture → hub:seed → hub-api :4000) → Dify mock :5001 → chat-web :3100, admin-web :3000,
// studio-web :3200 (`/studio/`). Runtime: in lệnh WSL (`AGENT_RT_PROVIDERS=claude-sub,dify`); `COMBINE_WSL=1` tự chạy.
// Env từng tiến trình: `combine.rules.ts` (`buildCombineEnv`). `HUB_INTERNAL_TOKEN` (từ `.env.local` hoặc sinh — không in)
// chỉ tới admin-api + hub-api: web chạy với bản chụp `process.env` TRƯỚC khi gộp env admin/hub (plan R2).
// Bun: env truyền vào tiến trình con thắng `--env-file=.env.local` (đã kiểm, plan R10). Ctrl+C dừng theo `stopOrder`.
// Không sửa hành vi `hub:dev` (`dev.ts`).
import { join } from "node:path";
import {
  buildCombineEnv,
  PORTS,
  type ProcName,
  START_ORDER,
  stopOrder,
  toWslPath,
  URLS,
  webEnv,
  wslRuntimeScript,
} from "../../scripts/src/combine.rules";
import { contractFixtureFromEnv, healthy, REPO, startHubDev } from "./dev";
import { startDifyMock } from "./dify-mock";
import { contractUsersJson, DEV_PASSWORD } from "./fixture";

type Stop = () => Promise<void> | void;
type Web = "chat-web" | "admin-web" | "studio-web";
export type Combine = { stop: () => Promise<void>; started: ProcName[]; notes: string[] };
export type CombineRunOpts = { wsl?: boolean; mock?: boolean; webTimeoutMs?: number };

const WEB_URL: Record<Web, string> = {
  "chat-web": URLS.chatWeb,
  "admin-web": URLS.adminWeb,
  "studio-web": URLS.studioWeb,
};

/** HTTP status của `url` (0 = không kết nối được). */
export async function statusOf(url: string, ms = 2_000): Promise<number> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: "manual" });
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}

/** Dừng tiến trình kèm cây con (`bun run dev` → rsbuild): Windows `taskkill /T`, nơi khác `kill`. */
async function killTree(p: Bun.Subprocess): Promise<void> {
  if (p.exitCode === null && p.signalCode === null) {
    if (process.platform === "win32")
      Bun.spawnSync(["taskkill", "/PID", String(p.pid), "/T", "/F"], {
        stdout: "ignore",
        stderr: "ignore",
      });
    else p.kill();
  }
  await Promise.race([p.exited, Bun.sleep(5_000)]);
}

function compose(): void {
  const r = Bun.spawnSync(["docker", "compose", "up", "-d", "--wait"], {
    cwd: REPO,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (r.exitCode !== 0) throw new Error(`docker compose up lỗi (exit=${r.exitCode})`);
}

/** Web dev (`bun run dev` trong app): cổng bận ⇒ lỗi rõ (strictPort); chờ `GET /` 200. */
async function startWeb(name: Web, env: Record<string, string>, timeoutMs: number): Promise<Stop> {
  const url = WEB_URL[name];
  if ((await statusOf(url)) !== 0)
    throw new Error(
      `${name}: cổng ${PORTS[name]} đang bận — dừng tiến trình đang giữ cổng rồi chạy lại`,
    );
  const proc = Bun.spawn([process.execPath, "run", "dev"], {
    cwd: join(REPO, "apps", name),
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if ((await statusOf(url)) === 200) return () => killTree(proc);
    if (proc.exitCode !== null) break;
    await Bun.sleep(1_000);
  }
  await killTree(proc);
  throw new Error(`${name} không lên ${url} trong ${timeoutMs / 1000}s (exit=${proc.exitCode})`);
}

/** Dify mock :5001 trong tiến trình này; cổng đã phản hồi ⇒ dùng lại (không dừng khi thoát). */
async function difyMockStep(notes: string[]): Promise<Stop | undefined> {
  if ((await statusOf(URLS.difyMock)) !== 0) {
    notes.push(`dify-mock ${URLS.difyMock} đã chạy sẵn — dùng lại`);
    return undefined;
  }
  try {
    const m = startDifyMock({ port: PORTS["dify-mock"] });
    return () => m.close();
  } catch (err) {
    notes.push(`dify-mock: ${(err as Error).message} — bỏ qua`);
    return undefined;
  }
}

/** `COMBINE_WSL=1`: Runtime trong WSL (stdin = script, tránh đổi đường dẫn MSYS); dừng bằng pkill trong WSL. */
function startWslRuntime(script: string): Stop {
  const wsl = ["wsl.exe", "-d", "Ubuntu", "-u", "worker", "--"];
  const proc = Bun.spawn([...wsl, "bash", "-l", "-s"], {
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
  });
  proc.stdin.write(script);
  proc.stdin.end();
  return async () => {
    Bun.spawnSync([...wsl, "pkill", "-TERM", "-f", "python -m agent_runtime"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await killTree(proc);
  };
}

type Tracker = { started: ProcName[]; stops: Map<ProcName, Stop>; notes: string[] };
const track = (t: Tracker, name: ProcName, stop?: Stop) => {
  if (stop) t.stops.set(name, stop);
  t.started.push(name);
};

/** Bước 2–3: hub-dev (admin-api + hub-api) → dify-mock → 3 web, ghi `started` theo đúng thứ tự bật. */
async function startProcs(
  t: Tracker,
  base: Record<string, string | undefined>,
  env: Record<ProcName, Record<string, string>>,
  opts: CombineRunOpts,
): Promise<void> {
  if (await healthy(URLS.admin))
    t.notes.push(
      "admin-api :3001 đã chạy sẵn — dùng lại; HUB_INTERNAL_TOKEN/ADMIN_HUB_URL có thể khác (Chạy thử ⇒ 503/401)",
    );
  if (await healthy(URLS.hub))
    throw new Error(
      "hub-api :4000 đang chạy sẵn (có thể là tiến trình mồ côi, thư mục đính kèm đã mất) — dừng nó rồi chạy lại",
    );
  Object.assign(process.env, env["admin-api"], env["hub-api"]);
  process.env.HUB_SEED_PROFILE ||= "claude-sub-1"; // Runtime thật (WSL claude-sub), không phải fake-1 của hub:dev
  const dev = await startHubDev({ contract: contractFixtureFromEnv() });
  track(t, "admin-api"); // dừng cùng `dev.stop` (no-op riêng)
  track(t, "hub-api", dev.stop);
  t.notes.push(...dev.notes);
  if (opts.mock !== false) {
    const s = await difyMockStep(t.notes);
    if (s) track(t, "dify-mock", s);
  }
  for (const w of START_ORDER.filter((p): p is Web => p.endsWith("-web")))
    track(t, w, await startWeb(w, webEnv(base, env[w]), opts.webTimeoutMs ?? 90_000));
}

export async function startCombine(
  opts: CombineRunOpts = {},
  onStop?: (stop: () => Promise<void>) => void,
): Promise<Combine> {
  const base: Record<string, string | undefined> = { ...process.env }; // chụp TRƯỚC khi gộp env admin/hub
  const env = buildCombineEnv(base, {
    token: base.HUB_INTERNAL_TOKEN,
    wsl: opts.wsl,
    mock: opts.mock,
  });
  const t: Tracker = { started: [], stops: new Map(), notes: [] };
  let runtimeStop: Stop | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      if (runtimeStop) await runtimeStop();
      for (const p of stopOrder(t.started)) await t.stops.get(p)?.();
    })();
    return stopping;
  };
  onStop?.(stop);
  try {
    compose();
    await startProcs(t, base, env, opts);
    const script = wslRuntimeScript(
      toWslPath(REPO),
      process.env.HUB_PUBLIC_INTERNAL_URL || URLS.hub,
    );
    if (opts.wsl) runtimeStop = startWslRuntime(script);
    else
      t.notes.push(
        `Runtime (WSL): lưu script dưới thành rt.sh rồi \`wsl.exe -d Ubuntu -u worker -- bash -l -s < rt.sh\` (hoặc COMBINE_WSL=1)
${script}`,
      );
    return { stop, started: t.started, notes: t.notes };
  } catch (err) {
    await stop();
    throw err;
  }
}

function banner(c: Combine): void {
  for (const n of c.notes) console.warn(`[combine] ${n}`);
  const rows: [string, string][] = [
    ["admin-web", URLS.adminWeb],
    ["chat-web", URLS.chatWeb],
    ["studio-web", URLS.studioWeb],
    ["admin-api", URLS.admin],
    ["hub-api", URLS.hub],
    ["dify-mock", `${URLS.difyMock}/v1 (secret mk-ok)`],
  ];
  console.log("[combine] sẵn sàng:");
  for (const [k, v] of rows) console.log(`  ${k.padEnd(11)} ${v}`);
  console.log(`[combine] user mẫu (mật khẩu ${DEV_PASSWORD}): ${contractUsersJson()}`);
  console.log(
    "[combine] Dify thật: `bun run seed:dify` (dry-run mặc định) — xem docs/guides/combine-test.md",
  );
  console.log("[combine] Ctrl+C để dừng.");
}

if (import.meta.main) {
  let stopFn: (() => Promise<void>) | undefined;
  let started: ProcName[] = [];
  const quit = async () => {
    console.log(`[combine] dừng: ${stopOrder(started).join(" → ")}`);
    await stopFn?.();
    process.exit(0);
  };
  process.once("SIGINT", () => void quit());
  process.once("SIGTERM", () => void quit());
  try {
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: cờ chỉ của script dev, không ảnh hưởng cache turbo
    const c = await startCombine({ wsl: process.env.COMBINE_WSL === "1" }, (s) => {
      stopFn = s;
    });
    started = c.started;
    banner(c);
  } catch (err) {
    console.error(`[combine] ${(err as Error).message}`);
    process.exit(1);
  }
}
