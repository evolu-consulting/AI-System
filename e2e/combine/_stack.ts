// X1 combine e2e · dựng backend: `_prepare.ts` (DB test) → Dify mock → admin-api → hub-api; rồi mở `/health` ở cổng báo sẵn sàng.
// Một webServer của Playwright (thứ tự phụ thuộc: hub-api cần DB đã chuẩn bị). Dừng: SIGTERM/SIGINT ⇒ dừng ngược thứ tự.
// KHÔNG Runtime, KHÔNG Dify thật (X1-R01..R05): `startDifyMock` + key sinh lúc chạy trong `_prepare.ts`.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startDifyMock } from "../../tools/hub-dev/src/dify-mock";

const REPO = resolve(import.meta.dir, "../..");
const env = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (e2e/combine/playwright.config.ts truyền xuống)`);
  return v;
};
const PORTS = {
  api: Number(process.env.COMBINE_API_PORT ?? 3021),
  hub: Number(process.env.COMBINE_HUB_PORT ?? 4040),
  dify: Number(process.env.COMBINE_DIFY_PORT ?? 4048),
  ready: Number(process.env.COMBINE_READY_PORT ?? 4049),
};

function hubDbUrl(owner: string): string {
  const u = new URL(owner);
  u.username = "hub_api";
  u.password = "hub_api_dev_pw";
  return u.toString();
}

async function healthy(base: string, proc: Bun.Subprocess): Promise<void> {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (proc.exitCode !== null)
      throw new Error(`${base}: tiến trình thoát (exit ${proc.exitCode})`);
    try {
      if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(2_000) })).ok) return;
    } catch {
      // chưa nghe cổng
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${base}/health không sẵn sàng sau 60s`);
}

const spawn = (file: string, extra: Record<string, string>): Bun.Subprocess =>
  Bun.spawn([process.execPath, file], {
    cwd: REPO,
    env: { ...process.env, ...extra },
    stdout: "inherit",
    stderr: "inherit",
  });

const prep = Bun.spawnSync([process.execPath, "e2e/combine/_prepare.ts"], {
  cwd: REPO,
  env: process.env,
  stdout: "inherit",
  stderr: "inherit",
});
if (prep.exitCode !== 0) throw new Error(`_prepare.ts lỗi (exit ${prep.exitCode})`);

const dify = startDifyMock({ port: PORTS.dify });
const token = env("HUB_INTERNAL_TOKEN");
const origins = [env("COMBINE_CHAT_ORIGIN"), env("COMBINE_ADMIN_ORIGIN")];
const hubUrl = `http://localhost:${PORTS.hub}`;
const api = spawn("apps/admin-api/src/server.ts", {
  APP_ENV: "test",
  PORT: String(PORTS.api),
  CORS_ORIGINS: origins.join(","),
  ADMIN_API_DATABASE_URL: env("TEST_ADMIN_API_DATABASE_URL"),
  ADMIN_HUB_URL: hubUrl,
  HUB_INTERNAL_TOKEN: token,
});
const hub = spawn("apps/hub-api/src/server.ts", {
  APP_ENV: "test",
  HUB_PORT: String(PORTS.hub),
  HUB_DATABASE_URL: hubDbUrl(env("TEST_DATABASE_URL")),
  REDIS_URL: process.env.REDIS_TEST_URL ?? "redis://localhost:6379/15",
  HUB_INSTANCE_ID: "e2e-combine",
  HUB_INTERNAL_TOKEN: token,
  HUB_PUBLIC_INTERNAL_URL: hubUrl,
  HUB_CORS_ORIGINS: origins.join(","),
  HUB_CONFIG_POLL_S: "2",
  HUB_MAX_CONCURRENT_RUNS: "20",
  HUB_ATTACH_DRIVER: "local",
  HUB_ATTACH_DIR: mkdtempSync(join(tmpdir(), "x1-combine-attach-")),
});
const stop = (): void => {
  hub.kill();
  api.kill();
  void dify.close();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await healthy(`http://localhost:${PORTS.api}`, api);
await healthy(hubUrl, hub);
Bun.serve({ port: PORTS.ready, fetch: () => new Response("ok") });
console.log(
  `[combine] sẵn sàng: admin-api :${PORTS.api} · hub-api :${PORTS.hub} · dify-mock :${PORTS.dify}`,
);
