// L1 (TECH-DEBT #224) · ADM-FR-07 · giới hạn đăng nhập trên Redis + Postgres thật (evotest): khoá theo tài khoản + backoff,
// không lộ tài khoản, trần IP (login, TOTP, đổi mật khẩu), Redis chết ⇒ 503, admin gỡ khoá (audit), nhánh scrypt legacy.
// Đồng hồ giả (`now`) cho cả DB lẫn Redis; mỗi app một tiền tố khoá Redis riêng.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { RateLimitedDetailsSchema } from "@ai/contracts";
import { createDb, hashPassword, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { createApp } from "../../../app";
import { type JwtKeys, loadJwtKeys } from "../../../lib/jwt";
import { createRedis, type Redis } from "../../../lib/redis";
import { parseMasterKey } from "../../../lib/secret-crypto";
import { importableHash } from "../../identity-import/domain/import.rules";
import { createDummyHash } from "../auth.service";
import { redisLoginLimiter } from "./limit.redis";
import { DEFAULT_LIMIT_POLICY, type LimitPolicy } from "./limit.rules";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
const REDIS = process.env.HUB_TEST_REDIS_URL;
if (!OWNER || !API || !REDIS) {
  throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL/HUB_TEST_REDIS_URL chưa đặt");
}

const TID = "01900000-0000-7000-8000-0000000011a1";
const ID = {
  boss: "01900000-0000-7000-8000-0000000011b0",
  an: "01900000-0000-7000-8000-0000000011b1",
  cleo: "01900000-0000-7000-8000-0000000011b2",
  dan: "01900000-0000-7000-8000-0000000011b3",
  leg: "01900000-0000-7000-8000-0000000011b4",
  eve: "01900000-0000-7000-8000-0000000011b5",
};
const PW = "bí mật 123";
const LEGACY = importableHash(
  "scrypt$00112233445566778899aabbccddeeff$" +
    "89dfac31c7b8af82a758ec98fdbf0505a8091293ae8613a019f69f85300419ba" +
    "5e62dcbff56e3be6fb74f27bff7d97b0413126355726a7d4b539e475617504a5",
) as string;
const MIN = 60_000;

const owner = postgres(OWNER, { max: 2, onnotice: () => {} });
const db = createDb(API, { max: 10 });
const redis: Redis = createRedis(REDIS);
const dead: Redis = createRedis("redis://127.0.0.1:1");
dead.on("error", () => {});
let keys: JwtKeys;
let dummyHash: string;
let clock = Date.now();
let ipSeq = 0;
const freshIp = () => `198.51.100.${++ipSeq % 250}`;

type App = ReturnType<typeof createApp>;
function mkApp(o: { policy?: Partial<LimitPolicy>; down?: boolean } = {}): App {
  const policy = { ...DEFAULT_LIMIT_POLICY, ...o.policy };
  const prefix = `t:l1:${Bun.randomUUIDv7()}:`;
  return createApp(
    { version: "0.0.0", corsOrigins: ["http://localhost:3000"] },
    {
      db,
      keys,
      appEnv: "test",
      dummyHash,
      legacySunset: new Date("2999-01-01T00:00:00.000Z"),
      now: () => new Date(clock),
      loginLimiter: redisLoginLimiter(o.down ? dead : redis, { prefix, policy }),
      trustProxyHops: 1,
      secretKey: parseMasterKey(randomBytes(32).toString("base64")),
    },
  );
}

type Res = {
  status: number;
  body: { error?: { code: string; message?: string; details?: unknown } } & Record<string, unknown>;
  headers: Headers;
  ms: number;
};
async function post(
  app: App,
  path: string,
  body: unknown,
  ip: string,
  token?: string,
): Promise<Res> {
  const t0 = performance.now();
  const res = await app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `6.6.6.6, ${ip}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : {},
    headers: res.headers,
    ms: performance.now() - t0,
  };
}
const login = (app: App, username: string, password: string, ip = freshIp(), tenant = "l1-acme") =>
  post(app, "/auth/login", { tenant_key: tenant, username, password }, ip);

/** n lần sai, mỗi lần một IP mới (không đụng trần IP); trả status từng lần. */
async function failN(app: App, username: string, n: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await login(app, username, "sai-mat-khau")).status);
  return out;
}

const auditOf = (id: string) =>
  owner<{ action: string; summary: Record<string, unknown> | null; actor_id: string | null }[]>`
    select action, summary, actor_id from admin.audit_log where entity_id = ${id} order by id`;

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  const h = await hashPassword(PW);
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'l1-acme', 'L1')`;
  await owner`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role) values
    (${ID.boss}, ${TID}, 'boss', 'boss@l1.test', ${h}, 'B', 'tenant_admin'),
    (${ID.an}, ${TID}, 'an', null, ${h}, 'A', 'member'), (${ID.cleo}, ${TID}, 'cleo', null, ${h}, 'C', 'member'),
    (${ID.dan}, ${TID}, 'dan', null, ${h}, 'D', 'member'), (${ID.leg}, ${TID}, 'leg', null, ${LEGACY}, 'L', 'member'),
    (${ID.eve}, ${TID}, 'eve', null, ${h}, 'E', 'member')`;
  await owner`update admin.users set must_change_password = false where tenant_id = ${TID}`;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  keys = await loadJwtKeys({
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "l1",
  });
  dummyHash = await createDummyHash();
  await redis.connect();
}, 60_000);

afterAll(async () => {
  redis.disconnect();
  dead.disconnect();
  await db.close();
  await owner.end();
});

describe("L1 · khoá theo tài khoản", () => {
  test("L1 · 5 lần sai 401, lần 6 (kể cả đúng mật khẩu) 423 TEMP_LOCKED until = now+15'; audit login_lockout (actor hệ thống)", async () => {
    const app = mkApp();
    expect(await failN(app, "an", 5)).toEqual([401, 401, 401, 401, 401]);
    const r = await login(app, "an", PW);
    expect(r.status).toBe(423);
    expect(r.body.error).toEqual({
      code: "TEMP_LOCKED",
      message: "Temporarily locked",
      details: { until: new Date(clock + 15 * MIN).toISOString() },
    });
    const rows = (await auditOf(ID.an)).filter((x) => x.summary?.op === "login_lockout");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "update", actor_id: null });
  });

  test("L1 · backoff: hết khoá, sai 5 lần nữa ⇒ khoá 30'; đúng mật khẩu sau khi hết khoá ⇒ 200 và bậc về 0", async () => {
    const app = mkApp();
    await failN(app, "dan", 5);
    clock += 16 * MIN;
    expect(await failN(app, "dan", 5)).toEqual([401, 401, 401, 401, 401]);
    const r = await login(app, "dan", PW);
    expect(r.status).toBe(423);
    expect(r.body.error?.details).toEqual({ until: new Date(clock + 30 * MIN).toISOString() });
    clock += 31 * MIN;
    expect((await login(app, "dan", PW)).status).toBe(200);
    await failN(app, "dan", 5);
    expect((await login(app, "dan", PW)).body.error?.details).toEqual({
      until: new Date(clock + 15 * MIN).toISOString(),
    });
    clock += 16 * MIN;
  });
});

describe("L1 · không lộ tài khoản", () => {
  test("L1 · tài khoản lạ và có thật: cùng chuỗi status, cùng body 401/423, cùng `until`; thời gian 401 cùng lớp", async () => {
    const app = mkApp();
    const real: Res[] = [];
    const ghost: Res[] = [];
    for (let i = 0; i < 6; i++) {
      real.push(await login(app, "eve", "sai-mat-khau"));
      ghost.push(await login(app, "khong-ton-tai", "sai-mat-khau"));
    }
    expect(real.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 423]);
    expect(ghost.map((r) => r.status)).toEqual(real.map((r) => r.status));
    expect(ghost.map((r) => r.body)).toEqual(real.map((r) => r.body));
    const med = (xs: Res[]) =>
      [...xs.slice(1, 5).map((r) => r.ms)].sort((a, b) => a - b)[2] as number;
    const ratio = med(real) / med(ghost);
    console.log(
      `L1 enum ms median 401: có thật ${med(real).toFixed(1)} · lạ ${med(ghost).toFixed(1)}`,
    );
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
    clock += 16 * MIN;
  }, 30_000);
});

describe("L1 · trần theo IP", () => {
  test("L1 · login: quá trần ⇒ 429 RATE_LIMITED + Retry-After + details; IP khác vẫn qua; hết cửa sổ thì qua", async () => {
    const app = mkApp({ policy: { ipMaxAttempts: 3 } });
    const ip = "203.0.113.50";
    for (let i = 0; i < 3; i++) expect((await login(app, `x${i}`, "sai", ip)).status).toBe(401);
    const r = await login(app, "boss", PW, ip);
    expect(r.status).toBe(429);
    expect(r.body.error?.code).toBe("RATE_LIMITED");
    const d = RateLimitedDetailsSchema.parse(r.body.error?.details);
    expect(r.headers.get("retry-after")).toBe(String(d.retry_after_s));
    expect(d.retry_after_s).toBeLessThanOrEqual(600);
    expect((await login(app, "boss", PW, "203.0.113.51")).status).toBe(200);
    clock += 10 * MIN;
    expect((await login(app, "boss", PW, ip)).status).toBe(200);
  });

  test("L1 · /auth/totp/verify và /auth/change-password dùng chung trần IP", async () => {
    const app = mkApp({ policy: { ipMaxAttempts: 2 } });
    const ip = "203.0.113.60";
    const totp = () => post(app, "/auth/totp/verify", { totp_token: "x.y.z", code: "123456" }, ip);
    expect([400, 401]).toContain((await totp()).status);
    const pw = { change_token: "x.y.z", new_password: "mat-khau-moi-123" };
    expect([400, 401]).toContain((await post(app, "/auth/change-password", pw, ip)).status);
    expect((await totp()).status).toBe(429);
    expect((await post(app, "/auth/change-password", pw, ip)).status).toBe(429);
    clock += 10 * MIN;
  });
});

describe("L1 · Redis chết ⇒ 503 (đóng an toàn)", () => {
  test("L1 · login (argon2 + legacy + tài khoản lạ), TOTP, đổi mật khẩu ⇒ 503 AUTH_UNAVAILABLE + Retry-After, không băm", async () => {
    const app = mkApp({ down: true });
    for (const u of ["boss", "leg", "khong-ton-tai"]) {
      const r = await login(app, u, PW);
      expect([r.status, r.body.error?.code]).toEqual([503, "AUTH_UNAVAILABLE"]);
      expect(r.headers.get("retry-after")).toMatch(/^\d+$/);
      expect(r.ms).toBeLessThan(50);
    }
    const t = await post(
      app,
      "/auth/totp/verify",
      { totp_token: "x.y.z", code: "123456" },
      freshIp(),
    );
    expect(t.status).toBe(503);
  });
});

describe("L1 · admin gỡ khoá", () => {
  test("L1 · tenant_admin unlock ⇒ xoá khoá Redis + DB, đăng nhập được ngay; audit unlock op login_lockout_clear actor = admin", async () => {
    const app = mkApp();
    await failN(app, "cleo", 5);
    expect((await login(app, "cleo", PW)).status).toBe(423);
    const boss = await login(app, "boss", PW);
    expect([boss.status, boss.body.error?.code]).toEqual([200, undefined]);
    const token = boss.body.access_token as string;
    const u = await post(app, `/admin/users/${ID.cleo}/unlock`, {}, freshIp(), token);
    expect([u.status, u.body.error?.code]).toEqual([200, undefined]);
    expect(u.body.locked_until).toBeNull();
    const after = await login(app, "cleo", PW);
    expect([after.status, after.body.error?.code]).toEqual([200, undefined]);
    const rows = await auditOf(ID.cleo);
    expect(rows.map((r) => [r.action, r.summary?.op, r.actor_id])).toEqual([
      ["update", "login_lockout", null],
      ["unlock", "login_lockout_clear", ID.boss],
    ]);
    const again = await post(app, `/admin/users/${ID.cleo}/unlock`, {}, freshIp(), token);
    expect(again.status).toBe(200);
    expect(await auditOf(ID.cleo)).toHaveLength(2);
  });
});

describe("L1 · nhánh scrypt legacy (N5b)", () => {
  test("L1 · hash legacy: 5 sai ⇒ lần 6 423 dù đúng mật khẩu (không chạy scrypt), hash chưa bị rehash", async () => {
    const app = mkApp();
    expect(await failN(app, "leg", 5)).toEqual([401, 401, 401, 401, 401]);
    const r = await login(app, "leg", PW);
    expect(r.status).toBe(423);
    const [row] = await owner<
      { h: string }[]
    >`select password_hash h from admin.users where id = ${ID.leg}`;
    expect(row?.h).toBe(LEGACY);
    clock += 16 * MIN;
    expect((await login(app, "leg", PW)).status).toBe(200);
  });
});
