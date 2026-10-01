// ADM-NFR-03 · ngân sách spec M1 §6: 5.000 user/tenant, p95 `GET /admin/users?q=` < 100 ms, `POST /auth/login` < 150 ms.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createDb, hashPassword, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { createApp } from "../../app";
import { loadJwtKeys } from "../../lib/jwt";
import { createDummyHash } from "../auth/auth.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const N = 5000;
/** ≥ 50 lần đo + 5 lần khởi động nóng: p95 ổn định khi máy đang chạy song song test khác (review M2 #2). */
const RUNS = 50;
const WARMUP = 5;
const PW = "Perf-Passw0rd-1";
const TID = "01900000-0000-7000-8000-0000000aa001";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 10 });
let app: ReturnType<typeof createApp>;

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] ?? 0;
const login = () =>
  app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenant_key: "perf", username: "boss", password: PW }),
  });

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  const hash = await hashPassword(PW);
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'perf', 'Perf')`;
  await owner`insert into admin.users (tenant_id, username, email, password_hash, display_name, role, must_change_password)
    values (${TID}, 'boss', 'boss@perf.test', ${hash}, 'Boss', 'tenant_admin', false)`;
  await owner`insert into admin.users (tenant_id, username, email, password_hash, display_name, role)
    select ${TID}, 'u' || lpad(g::text, 5, '0'), 'u' || g || '@perf.test', ${hash}, 'User ' || g, 'member'
    from generate_series(1, ${N - 1}) g`;
  await owner`analyze admin.users`;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys = await loadJwtKeys({
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "perf",
  });
  app = createApp(
    { version: "0.0.0", corsOrigins: ["http://localhost:3000"] },
    { db, keys, appEnv: "test", dummyHash: await createDummyHash() },
  );
}, 60_000);
afterAll(async () => {
  await db.close();
  await owner.end();
});

async function timed(fn: () => Response | Promise<Response>): Promise<number[]> {
  for (let w = 0; w < WARMUP; w++) await fn(); // làm nóng kết nối/plan/JIT
  const out: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const res = await fn();
    out.push(performance.now() - t0);
    expect(res.status).toBe(200);
  }
  return out;
}

describe("ADM-NFR-03 · hiệu năng users", () => {
  test("ADM-NFR-03 · POST /auth/login p95 < 150 ms", async () => {
    expect(p95(await timed(login))).toBeLessThan(150);
  });

  test("ADM-NFR-03 · GET /admin/users?q= p95 < 100 ms (5.000 user)", async () => {
    const token = ((await (await login()).json()) as { access_token: string }).access_token;
    const get = () =>
      app.request("/admin/users?q=user%2012&limit=50", {
        headers: { authorization: `Bearer ${token}` },
      });
    expect(p95(await timed(get))).toBeLessThan(100);
  });
});
