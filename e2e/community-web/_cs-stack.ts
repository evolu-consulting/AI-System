// e2e-stack-server · dựng backend THẬT cho `playwright.stack.config.ts` (community-web, 3 vai) — mẫu `e2e/P-a/_pa-stack.ts`:
// reset DB test riêng việc → migrate main/hub/gói → `hub:seed` → seed tenant `demo` + demo-owner + cộng đồng đối tác
// (`seed-community-demo`, gọi thẳng hàm thư viện: CLI từ chối host DB `pg` của evotest) → admin-api → hub-api → mở cổng "sẵn sàng".
// Chỉ chạy với APP_ENV=test và DB tên kết thúc `_test` (kiểm bên dưới). Mật khẩu demo-owner = env DEMO_OWNER_PW (config sinh ngẫu
// nhiên mỗi lượt), mật khẩu tạm đối tác ghi vào file CS_SEED_OUT (config đặt = COMMUNITY_SEED_PW_FILE cho `_stack.ts`).
// Dừng: SIGTERM/SIGINT.
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { createDb } from "@ai/db";
import { runHubMigrations } from "@ai/db/migrate-hub";
import { runPackMigrations } from "@ai/db/migrate-packs";
import { runSeed } from "../../tools/scripts/src/seed-community-demo";
import {
  ensureContractsPack,
  ensureDemoTenant,
  ensureOwnerInGroup,
} from "../../tools/scripts/src/seed-community-demo.dev-fixture";
import { prepareDbWithRetry } from "../x1/_prepare";

const REPO = resolve(import.meta.dir, "../..");
const env = (n: string): string => {
  const v = process.env[n];
  if (!v)
    throw new Error(`${n} chưa đặt (e2e/community-web/playwright.stack.config.ts truyền xuống)`);
  return v;
};
const PORTS = {
  api: Number(env("CS_API_PORT")),
  hub: Number(env("CS_HUB_PORT")),
  ready: Number(env("CS_READY_PORT")),
};

function hubDbUrl(owner: string): string {
  const u = new URL(owner);
  u.username = "hub_api";
  u.password = "hub_api_dev_pw";
  return u.toString();
}

/** Chặn cứng: chỉ DB test e2e (tên `*_test`) và APP_ENV=test — stack này xoá sạch DB khi khởi động. */
function guard(url: string): void {
  const db = decodeURIComponent(new URL(url).pathname.slice(1));
  if (process.env.APP_ENV !== "test" || !db.endsWith("_test"))
    throw new Error(
      `cs-stack: từ chối — cần APP_ENV=test và DB *_test (APP_ENV=${process.env.APP_ENV}, db=${db})`,
    );
}

async function prepare(): Promise<void> {
  const url = env("TEST_DATABASE_URL");
  guard(url);
  prepareDbWithRetry();
  await runHubMigrations({ url, appEnv: "test" });
  await runPackMigrations({ url, appEnv: "test" });
  const seed = Bun.spawnSync([process.execPath, "apps/hub-api/src/modules/seed/seed.ts"], {
    cwd: REPO,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, DATABASE_URL: url, HUB_SEED_FIXTURES: "1" },
  });
  if (seed.exitCode !== 0) throw new Error("hub:seed lỗi");
  const out = env("CS_SEED_OUT");
  for (const f of [out, `${out}.community.json`]) rmSync(f, { force: true });
  const db = createDb(url, { max: 2 });
  const hubDb = createDb(hubDbUrl(url), { max: 2 });
  try {
    const t = await ensureDemoTenant(db, env("DEMO_OWNER_PW"));
    console.log(`[cs] tenant demo ${t.tenant}, demo-owner ${t.owner}`);
    await runSeed(db, { tenantKey: "demo", apply: true, forceTenant: false, out, hubDb });
    console.log(`[cs] demo-owner ∈ community-owner: ${await ensureOwnerInGroup(db)}`);
    // CR-118: web gộp lấy `apps`/`home` từ /pack/me ⇒ tenant demo phải có gói contracts bật (thành viên SHT vào /overview).
    // Nhóm contracts-owner do enablePack tạo; demo-owner được thêm ở bước seed fixture bên dưới.
    console.log(`[cs] gói contracts cho demo: ${await ensureContractsPack(db)}`);
  } finally {
    await hubDb.close();
    await db.close();
  }
  // seed-refresh: thương hiệu host, nhóm Kế toán, owner gói… dùng chung với dev (tenant demo vừa có xong ⇒ chạy lại seed fixture).
  const fx = Bun.spawnSync(
    [process.execPath, "apps/hub-api/src/modules/seed/seed.tenant-fixtures.ts"],
    {
      cwd: REPO,
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, DATABASE_URL: url, HUB_SEED_FIXTURES: "1" },
    },
  );
  if (fx.exitCode !== 0) throw new Error("hub:seed:fixtures lỗi");
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

if (import.meta.main) {
  await prepare();
  const origin = env("CS_WEB_ORIGIN");
  const hubUrl = `http://localhost:${PORTS.hub}`;
  const api = spawn("apps/admin-api/src/server.ts", {
    APP_ENV: "test",
    PORT: String(PORTS.api),
    CORS_ORIGINS: [origin, process.env.CS_ADMIN_ORIGIN].filter(Boolean).join(","),
    ADMIN_API_DATABASE_URL: env("TEST_ADMIN_API_DATABASE_URL"),
    ADMIN_HUB_URL: hubUrl,
  });
  const hub = spawn("apps/hub-api/src/server.ts", {
    APP_ENV: "test",
    HUB_PORT: String(PORTS.hub),
    HUB_DATABASE_URL: hubDbUrl(env("TEST_DATABASE_URL")),
    REDIS_URL: `redis://localhost:6379/${env("CS_REDIS_DB")}`,
    HUB_INSTANCE_ID: "e2e-cs",
    HUB_CORS_ORIGINS: [origin, process.env.CS_ADMIN_ORIGIN].filter(Boolean).join(","),
    HUB_CONFIG_POLL_S: "2",
  });
  const stop = (): void => {
    hub.kill();
    api.kill();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await healthy(`http://localhost:${PORTS.api}`, api);
  await healthy(hubUrl, hub);
  Bun.serve({ port: PORTS.ready, fetch: () => new Response("ok") });
  console.log(
    `[cs] sẵn sàng: admin-api :${PORTS.api} · hub-api :${PORTS.hub} · ready :${PORTS.ready}`,
  );
}
