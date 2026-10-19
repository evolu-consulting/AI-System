// L1 (TECH-DEBT #224) · ADM-NFR-03: POST /auth/login p95 < 150 ms khi bật giới hạn (Redis: 1 script trước + 1 DEL sau
// khi đúng mật khẩu) + semaphore. In số đo "trước" (không limiter) → "sau" (limiter + Redis thật).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createDb, hashPassword, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { createApp } from "../../../app";
import { loadJwtKeys } from "../../../lib/jwt";
import { createRedis } from "../../../lib/redis";
import { createDummyHash } from "../auth.service";
import { redisLoginLimiter } from "./limit.redis";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
const REDIS = process.env.HUB_TEST_REDIS_URL;
if (!OWNER || !API || !REDIS) {
  throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL/HUB_TEST_REDIS_URL chưa đặt");
}

const TID = "01900000-0000-7000-8000-0000000012a1";
const PW = "bí mật 123";
const RUNS = 30;
const owner = postgres(OWNER, { max: 2, onnotice: () => {} });
const db = createDb(API, { max: 10 });
const redis = createRedis(REDIS);
type App = ReturnType<typeof createApp>;
let plain: App;
let limited: App;

const p95 = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] as number;
let ip = 0;
const login = (app: App) =>
  app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${ip++ % 250}.1` },
    body: JSON.stringify({ tenant_key: "perf-l1", username: "argon", password: PW }),
  });

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'perf-l1', 'Perf')`;
  await owner`insert into admin.users (tenant_id, username, password_hash, display_name, role, must_change_password)
    values (${TID}, 'argon', ${await hashPassword(PW)}, 'A', 'member', false)`;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys = await loadJwtKeys({
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "perf",
  });
  await redis.connect();
  const deps = { db, keys, appEnv: "test" as const, dummyHash: await createDummyHash() };
  const cfg = { version: "0.0.0", corsOrigins: ["http://localhost:3000"] };
  plain = createApp(cfg, deps);
  const loginLimiter = redisLoginLimiter(redis, { prefix: `t:l1p:${Bun.randomUUIDv7()}:` });
  limited = createApp(cfg, { ...deps, loginLimiter, trustProxyHops: 1 });
}, 60_000);
afterAll(async () => {
  redis.disconnect();
  await db.close();
  await owner.end();
});

async function timed(app: App): Promise<number[]> {
  for (let w = 0; w < 3; w++) expect((await login(app)).status).toBe(200);
  const out: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const res = await login(app);
    out.push(performance.now() - t0);
    expect(res.status).toBe(200);
  }
  return out;
}

describe("L1 · ADM-NFR-03 · login p95 < 150 ms khi bật giới hạn", () => {
  test("L1 · p95 không limiter → có limiter (Redis thật)", async () => {
    const before = p95(await timed(plain));
    const after = p95(await timed(limited));
    console.log(
      `L1 perf login p95 ms: không limiter ${before.toFixed(1)} → có limiter ${after.toFixed(1)}`,
    );
    expect(after).toBeLessThan(150);
  }, 60_000);
});
