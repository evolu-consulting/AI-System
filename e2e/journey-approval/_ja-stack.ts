// e2e-journey-approval · backend THẬT cho `playwright.journey.config.ts` — admin-api + hub-api (hai tiến trình riêng như prod) trên DB test
// riêng: reset → migrate (main/hub/gói) → hub:seed → admin-api → DỰNG TENANT `e2e-approval` bằng đúng đường seed-niti (onboardTenant +
// createUser + vai gói + quy trình thư viện; KHÔNG gán quy trình, KHÔNG luật chọn, KHÔNG feature `contracts-approval-engine`) → hub-api.
// Cấu hình hub GIỐNG prod (HUB_PROCESS_ENGINE=on, CONTRACTS_APPROVAL_ENGINE=on ⇒ engine chỉ chạy cho tenant có entitlement).
// Duy nhất thứ giả: CLI Claude (nhà cung cấp AI ngoài) — `AI_SUB_CLI_PATH` trỏ tệp giả trả JSON trích của HĐ mẫu; mọi thứ khác là code thật.
// Chỉ APP_ENV=test + DB `*_test`. Dừng: SIGTERM/SIGINT.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDb } from "@ai/db";
import { runHubMigrations } from "@ai/db/migrate-hub";
import { runPackMigrations } from "@ai/db/migrate-packs";
import { connectDb } from "../../apps/hub-api/src/lib/db";
import { startFbFake } from "../../tests/acceptance/FB1/_fbfake";
import {
  provisionExtraJourneyTenant,
  provisionJourneyTenant,
} from "../../tools/scripts/src/seed-e2e-journey";
import { prepareDbWithRetry } from "../x1/_prepare";

const REPO = resolve(import.meta.dir, "../..");
const env = (n: string): string => {
  const v = process.env[n];
  if (!v)
    throw new Error(
      `${n} chưa đặt (e2e/journey-approval/playwright.journey.config.ts truyền xuống)`,
    );
  return v;
};
const PORTS = {
  api: Number(env("JA_API_PORT")),
  hub: Number(env("JA_HUB_PORT")),
  ready: Number(env("JA_READY_PORT")),
};

function hubDbUrl(owner: string): string {
  const u = new URL(owner);
  u.username = "hub_api";
  u.password = "hub_api_dev_pw";
  return u.toString();
}

function guard(url: string): void {
  const db = decodeURIComponent(new URL(url).pathname.slice(1));
  if (process.env.APP_ENV !== "test" || !db.endsWith("_test"))
    throw new Error(`ja-stack: từ chối — cần APP_ENV=test và DB *_test (db=${db})`);
}

/** bun thật (PATH của `bun test` có thể trỏ shim); dùng cho shebang / biên dịch CLI giả. */
const bunExe = (): string => process.execPath;

/** CLI Claude GIẢ: đọc lời nhắc (stdin) rồi in một kết quả `claude -p --output-format json` chứa JSON trích của HĐ mẫu. */
function writeFakeClaude(file: string): string {
  mkdirSync(dirname(file), { recursive: true });
  const fixture = resolve(import.meta.dir, "_fixture.ts").replaceAll("\\", "/");
  const src = `import { buyContract, extractionFor, TAG } from ${JSON.stringify(fixture)};
const prompt = await Bun.stdin.text();
const run = new RegExp(TAG + "-([a-z0-9]+)/HĐMB").exec(prompt)?.[1] ?? "x";
const total = Number((/Tổng giá trị hợp đồng: ([\\d.]+) đồng/.exec(prompt)?.[1] ?? "11500000").replaceAll(".", ""));
const out = extractionFor(buyContract(run, total));
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(out),
  usage: { input_tokens: 100, output_tokens: 50 } }));
`;
  if (process.platform === "win32") {
    const ts = `${file}.ts`;
    writeFileSync(ts, src);
    const exe = `${file}.exe`;
    const b = Bun.spawnSync([bunExe(), "build", "--compile", ts, "--outfile", exe]);
    if (b.exitCode !== 0) throw new Error(`build CLI giả: ${b.stderr.toString()}`);
    return exe;
  }
  writeFileSync(file, `#!${bunExe()}\n${src}`);
  chmodSync(file, 0o755);
  return file;
}

const sub = (file: string, extra: Record<string, string> = {}): void => {
  const r = Bun.spawnSync([process.execPath, file], {
    cwd: REPO,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...extra },
  });
  if (r.exitCode !== 0) throw new Error(`${file} lỗi (exit ${r.exitCode})`);
};

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

async function main(): Promise<void> {
  const url = env("TEST_DATABASE_URL");
  guard(url);
  prepareDbWithRetry();
  await runHubMigrations({ url, appEnv: "test" });
  await runPackMigrations({ url, appEnv: "test" });
  sub("apps/hub-api/src/modules/seed/seed.ts", { DATABASE_URL: url, HUB_SEED_FIXTURES: "1" });

  const origins = env("JA_ORIGINS");
  const hubUrl = `http://localhost:${PORTS.hub}`;
  const api = spawn("apps/admin-api/src/server.ts", {
    APP_ENV: "test",
    PORT: String(PORTS.api),
    CORS_ORIGINS: origins,
    ADMIN_API_DATABASE_URL: env("TEST_ADMIN_API_DATABASE_URL"),
    ADMIN_HUB_URL: hubUrl,
  });
  let hub: Bun.Subprocess | null = null;
  const stop = (): void => {
    hub?.kill();
    api.kill();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await healthy(`http://localhost:${PORTS.api}`, api);

  // Dựng tenant như seed-niti (cùng service admin-api/hub-api); mật khẩu cố định cho 4 tài khoản = env JA_USER_PW.
  const admin = createDb(env("TEST_ADMIN_API_DATABASE_URL"), { max: 2 });
  const hubDb = connectDb(hubDbUrl(url), 2);
  try {
    const rep = await provisionJourneyTenant(admin, hubDb, { pw: env("JA_USER_PW") });
    console.log(
      `[ja] tenant e2e-approval: ${rep.tenant}; quy trình ${rep.processes.map((p) => `${p.key}=${p.state}`).join(", ")}`,
    );
    // CR-121 D-5: hai công ty MỚI cho hành trình 2 tenant (chưa gán quy trình/luật nào; platform admin làm trong spec).
    const sfx = process.env.JA_D5_SUFFIX;
    if (sfx)
      for (const k of ["a", "b"] as const)
        await provisionExtraJourneyTenant(admin, hubDb, {
          pw: env("JA_USER_PW"),
          key: `e2e-d5${k}-${sfx}`,
          name: `E2E D5${k.toUpperCase()} ${sfx}`,
        });
    // CR-121 D-6b: một công ty MỚI cho hành trình Thông báo sau bước duyệt (cùng hậu tố, khoá riêng).
    if (sfx)
      await provisionExtraJourneyTenant(admin, hubDb, {
        pw: env("JA_USER_PW"),
        key: `e2e-d6-${sfx}`,
        name: `E2E D6 ${sfx}`,
      });
    // CR-124 q6: hai công ty MỚI cho hành trình gửi đối tác (A gửi, B nhận). Chưa bật tính năng `contracts-partner-confirm`, chưa hồ sơ/danh bạ/flow:
    // platform admin + quản trị B làm hết trong spec bằng đường thật (D5).
    if (sfx)
      for (const k of ["a", "b"] as const)
        await provisionExtraJourneyTenant(admin, hubDb, {
          pw: env("JA_USER_PW"),
          key: `e2e-q6${k}-${sfx}`,
          name: `E2E Q6${k.toUpperCase()} ${sfx}`,
        });
    // CR-122 Q1: hai công ty MỚI cho hành trình flow (G1/G2 và các ca UI trình sửa) — cờ FLOW_TRIGGERS do spec bật.
    if (sfx)
      for (const k of ["c22", "c22u", "c22n", "q5", "u6", "s2", "s3", "s7a", "s7b"] as const)
        await provisionExtraJourneyTenant(admin, hubDb, {
          pw: env("JA_USER_PW"),
          key: `e2e-${k}-${sfx}`,
          name: `E2E ${k.toUpperCase()} ${sfx}`,
        });
  } finally {
    await admin.close();
    await hubDb.close();
  }

  const fb = startFbFake();
  const cli = writeFakeClaude(resolve(REPO, "test-results/journey-approval/fake-claude"));
  hub = spawn("apps/hub-api/src/server.ts", {
    APP_ENV: "test",
    HUB_PORT: String(PORTS.hub),
    HUB_DATABASE_URL: hubDbUrl(url),
    REDIS_URL: `redis://localhost:6379/${env("JA_REDIS_DB")}`,
    HUB_INSTANCE_ID: "e2e-ja",
    HUB_CORS_ORIGINS: origins,
    HUB_CONFIG_POLL_S: "2",
    HUB_PROCESS_ENGINE: "on",
    CONTRACTS_APPROVAL_ENGINE: "on",
    HUB_PARTNER_MAILBOX: "on", // CR-124 · q5 · bộ chuyển hộp thư liên công ty (mặc định prod: tắt)
    // CR-123 u6b: "Ký thử" (selfsign, không mạng) cho hành trình thẻ duyệt có node Ký số; công ty nào bật ký số do spec đặt.
    ESIGN_PROVIDERS: "selfsign",
    AI_PROVIDER: "subscription",
    AI_SUB_CLI_PATH: cli,
    // FileBox: prod dùng FileBox HTTP; ở đây FileBox GIẢ trong tiến trình (hợp đồng thật, tests/acceptance/FB1/_fbfake.ts)
    HUB_ATTACH_DRIVER: "filebox",
    FILEBOX_URL: fb.origin,
    FILEBOX_ORG: "ai-system",
    FILEBOX_TOKEN: fb.token,
  });
  await healthy(hubUrl, hub);
  Bun.serve({ port: PORTS.ready, fetch: () => new Response("ok") });
  console.log(
    `[ja] sẵn sàng: admin-api :${PORTS.api} · hub-api :${PORTS.hub} · ready :${PORTS.ready}`,
  );
}

await main();
