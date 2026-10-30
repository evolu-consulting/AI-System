// Chạy Playwright bằng Node thật (không qua shim node của Bun): `bun tools/scripts/src/run-playwright.ts <config> [args…]`.
// Dùng lại resolveNodeDir/detectRealNode của done:pd1.
// e2e-isolation: chạy trực tiếp tự lấy "làn" của checkout (cổng, DB test, Redis DB) — không cần đặt env tay; biến đã đặt
// vẫn thắng. Thoát (kể cả lỗi / Ctrl-C) là dọn cây tiến trình mình bật.

import { existsSync } from "node:fs";
import { playwrightArgv } from "./done-n1.rules";
import { detectRealNode, REPO, stepEnv } from "./done-pd1";
import { resolveNodeDir } from "./done-pd1.rules";
import { installCleanup, leaseRedisDb, resolveLane } from "./e2e-lane";
import { LOGIN_IP_MAX, laneEnvFile, lanePortEnv, REDIS_VARS, redisEnvFor } from "./e2e-lane.rules";

const norm = (s: string) => s.replaceAll("\\", "/");

/** Làn > 0 dùng env-file DB riêng; thiếu file thì tạo bằng `db:test:create` (migrate từ mẫu). */
function ensureLaneDb(lane: number, config: string, env: Record<string, string | undefined>) {
  const m = lane > 0 ? laneEnvFile(lane, norm(config)) : null;
  if (!m || env[m.var]) return {};
  if (!existsSync(`${REPO}/${m.file}`)) {
    const p = Bun.spawnSync(
      ["bun", "--env-file=.env.local", "packages/db/src/test-db-cli.ts", "create", m.tag],
      { cwd: REPO, stdout: "inherit", stderr: "inherit" },
    );
    if (p.exitCode !== 0) throw new Error(`db:test:create ${m.tag} lỗi`);
  }
  return { [m.var]: m.file };
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  // Đối số đầu dạng KEY=VAL là biến môi trường cho Playwright (vd `CW_MODE=capture`), sau đó là config rồi đối số thêm.
  let n = 0;
  while (/^\w+=/.test(argv[n] ?? "")) n++;
  const sets = argv.slice(0, n);
  const [config, ...extra] = argv.slice(n);
  const extraEnv: Record<string, string> = Object.fromEntries(
    sets.map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]),
  );
  if (!config) {
    console.error("Dùng: bun tools/scripts/src/run-playwright.ts <config> [args…]");
    return 2;
  }
  const nodeDir = resolveNodeDir({
    override: env.PLAYWRIGHT_NODE_DIR,
    nodeOnPath: detectRealNode(),
    exists: existsSync,
  });
  const argvOut = playwrightArgv(
    { bun: process.execPath, platform: process.platform, nodeDir },
    config,
    extra,
  );
  const underPar = env.E2E_PAR === "1"; // `test:e2e:par` đã lo làn / Redis / dọn
  const lane = underPar ? Number(env.E2E_PORT_SHIFT ?? 0) / 3000 : resolveLane(REPO, env);
  const pids = new Set<number>();
  installCleanup(pids, REPO, lane, !underPar);
  let release = () => {};
  const laneEnv: Record<string, string> = {};
  if (!underPar) {
    Object.assign(laneEnv, lanePortEnv(lane, env), ensureLaneDb(lane, config, env));
    if (!env.LOGIN_IP_MAX_ATTEMPTS) laneEnv.LOGIN_IP_MAX_ATTEMPTS = LOGIN_IP_MAX;
    const rv = REDIS_VARS[norm(config)];
    if (rv && !rv.vars.some((v) => env[v] || extraEnv[v])) {
      const lease = await leaseRedisDb(`${REPO}#${config}`);
      release = lease.release;
      Object.assign(
        laneEnv,
        redisEnvFor(norm(config), lease.db, env.REDIS_URL ?? "redis://localhost:6379"),
      );
    }
  }
  try {
    const p = Bun.spawn(argvOut, {
      cwd: REPO,
      env: stepEnv({
        title: "playwright",
        argv: argvOut,
        env: { ...laneEnv, ...extraEnv },
        ...(nodeDir ? { nodeDir } : {}),
      }),
      stdout: "inherit",
      stderr: "inherit",
    });
    pids.add(p.pid);
    return (await p.exited) ?? 1;
  } finally {
    release();
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
