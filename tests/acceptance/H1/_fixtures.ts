// HUB-FR-01, HUB-FR-75 · hạ tầng test int H1 nhóm A (test-plan H1 §1–2): DB riêng `ai_system_h1_test`, dữ liệu SQL owner,
// khoá JWT EdDSA sinh trong test, hub-api thật (`createApp`) sau `Bun.serve` cổng 0. Không chứa `it(...)`.
// Dùng chung cho QW-A1 (`auth`, `isolation`) và QW-A2. Fixture không giữ trạng thái chung giữa ca (CONVENTIONS §2 bẫy).
import { CHAT_API_ERRORS, type ChatErrorCode, ErrorResponseSchema } from "@ai/contracts/chat";
import { runMigrations } from "@ai/db";
import { runHubMigrations } from "@ai/db/migrate-hub";
import { resetTestDb, withDatabase } from "@ai/db/test-db";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import postgres from "postgres";
import { type AppDeps, createApp } from "../../../apps/hub-api/src/app";
import { connectDb, type Db, pingDb } from "../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis, type Redis } from "../../../apps/hub-api/src/lib/redis";

export type Sql = postgres.Sql;
// biome-ignore lint/suspicious/noExplicitAny: body JSON của response; mỗi ca tự kiểm bằng schema contract
export type Json = any;

// ---------- DB ----------
const DB_NAME = "ai_system_h1_test";
/** Biến test tuỳ chọn (`.env.example` mục Test H1); đọc một chỗ. */
const ENV = {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến test, không thuộc task turbo
  hubTest: process.env.HUB_TEST_DATABASE_URL,
  test: process.env.TEST_DATABASE_URL,
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến test, không thuộc task turbo
  agentRt: process.env.AGENT_RT_TEST_DATABASE_URL,
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến test tuỳ chọn, mặc định DB 15 (test-plan §2)
  redis: process.env.HUB_TEST_REDIS_URL,
};
const BASE = ENV.hubTest ?? ENV.test;
if (!BASE)
  throw new Error("HUB_TEST_DATABASE_URL/TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
export const OWNER_URL = ENV.hubTest ?? withDatabase(BASE, DB_NAME);

export function withCreds(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}
/** Role `hub_api` (NOBYPASSRLS), mật khẩu dev ở `migrations-hub-dev` (plan §3.4). */
export const HUB_API_URL = withCreds(OWNER_URL, "hub_api", "hub_api_dev_pw");
export const AGENT_RT_URL =
  ENV.agentRt ?? withCreds(OWNER_URL, "agent_runtime", "agent_runtime_dev_pw");
export const REDIS_TEST_URL = ENV.redis ?? "redis://localhost:6379/15";

/** Tạo DB nếu thiếu (như `migrate-hub.int.test.ts`), xoá schema, migrate Admin + Hub (`appEnv: test`). */
export async function prepareDb(): Promise<void> {
  if (!ENV.hubTest) {
    const m = postgres(withDatabase(OWNER_URL, "postgres"), { max: 1, onnotice: () => {} });
    try {
      const [row] = await m`select 1 as one from pg_database where datname = ${DB_NAME}`;
      if (!row) await m.unsafe(`CREATE DATABASE "${DB_NAME}"`);
    } finally {
      await m.end();
    }
  }
  await resetTestDb(OWNER_URL);
  await runMigrations({ url: OWNER_URL, appEnv: "test" });
  await runHubMigrations({ url: OWNER_URL, appEnv: "test" });
}

export const ownerSql = (): Sql => postgres(OWNER_URL, { max: 2, onnotice: () => {} });

// ---------- dữ liệu cố định (test-plan §1; readiness lần 4 #52: `hoa` locale `en`, còn lại `vi`) ----------
const u = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const T = { acme: u(1), beta: u(2), platform: u(3), zeta: u(4), gamma: u(5) } as const;
export type UserKey =
  | "lan"
  | "hoa"
  | "tadmin"
  | "an"
  | "padmin"
  | "khoa"
  | "nghi"
  | "zed"
  | "gam"
  | "tam";
type UserRow = {
  id: string;
  tid: string;
  username: string;
  role: "member" | "tenant_admin" | "platform_admin";
  locale: "vi" | "en";
  active: boolean;
  locked: boolean;
};
const row = (
  n: number,
  tid: string,
  username: string,
  role: UserRow["role"] = "member",
  extra: Partial<UserRow> = {},
): UserRow => ({
  id: u(100 + n),
  tid,
  username,
  role,
  locale: "vi",
  active: true,
  locked: false,
  ...extra,
});
export const USERS: Record<UserKey, UserRow> = {
  lan: row(1, T.acme, "lan"),
  hoa: row(2, T.acme, "hoa", "member", { locale: "en" }),
  tadmin: row(3, T.acme, "tadmin", "tenant_admin"),
  an: row(4, T.beta, "an"),
  padmin: row(5, T.platform, "padmin", "platform_admin"),
  // khoá sẵn (A1): user bị tenant khoá, user không hoạt động, user của tenant không hoạt động
  khoa: row(6, T.acme, "khoa", "member", { locked: true }),
  nghi: row(7, T.acme, "nghi", "member", { active: false }),
  zed: row(8, T.zeta, "zed"),
  // A2 đổi trạng thái giữa ca rồi trả lại: tenant `gamma` (user `gam`), user `tam` (acme)
  gam: row(9, T.gamma, "gam"),
  tam: row(10, T.acme, "tam"),
};

/** Tài nguyên của `lan` (A5) + một hội thoại của `an` (A7). */
export const R = {
  conv: u(201),
  flow: u(211),
  flow2: u(212),
  runDone: u(221),
  runLive: u(222),
  msgU1: u(231),
  msgA1: u(232),
  msgU2: u(233),
  msgA2: u(234),
  anConv: u(241),
  anFlow: u(242),
} as const;
/** uuid không tồn tại — body 404 phải giống hệt tài nguyên của người khác. */
export const UNKNOWN = "a1000000-0000-4000-8000-0000000fffff";

export async function insertFixture(sql: Sql): Promise<void> {
  await sql`insert into admin.tenants (id, key, name, active) values
    (${T.acme}, 'acme', 'Acme Corp', true), (${T.beta}, 'beta', 'Beta Co', true),
    (${T.platform}, 'platform', 'Platform', true), (${T.zeta}, 'zeta', 'Zeta Ltd', false),
    (${T.gamma}, 'gamma', 'Gamma', true)`;
  const rows = Object.values(USERS).map((x) => ({
    id: x.id,
    tenant_id: x.tid,
    username: x.username,
    email: `${x.username}@example.test`,
    password_hash: "x",
    display_name: x.username,
    role: x.role,
    locale: x.locale,
    active: x.active,
    locked_by_tenant: x.locked,
    must_change_password: false,
  }));
  await sql`insert into admin.users ${sql(rows)}`;
  const L = USERS.lan;
  await sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm) values
    (${R.conv}, ${L.tid}, ${L.id}, 'Hoá đơn tháng 9', 'hoa don thang 9'),
    (${R.anConv}, ${USERS.an.tid}, ${USERS.an.id}, 'Của An', 'cua an')`;
  await sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count) values
    (${R.flow}, ${L.tid}, ${L.id}, ${R.conv}, 'Hoá đơn tháng 9', 2),
    (${R.flow2}, ${L.tid}, ${L.id}, ${R.conv}, 'Đang chạy', 2),
    (${R.anFlow}, ${USERS.an.tid}, ${USERS.an.id}, ${R.anConv}, 'Của An', 0)`;
  await sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content, run_id) values
    (${R.msgU1}, ${L.tid}, ${L.id}, ${R.conv}, ${R.flow}, 'user', 'Tổng hoá đơn?', null),
    (${R.msgA1}, ${L.tid}, ${L.id}, ${R.conv}, ${R.flow}, 'assistant', '12 hoá đơn', ${R.runDone}),
    (${R.msgU2}, ${L.tid}, ${L.id}, ${R.conv}, ${R.flow2}, 'user', 'Viết email', null),
    (${R.msgA2}, ${L.tid}, ${L.id}, ${R.conv}, ${R.flow2}, 'assistant', '', ${R.runLive})`;
  await sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, last_seq, finished_at) values
    (${R.runDone}, ${L.tid}, ${L.id}, ${R.conv}, ${R.flow}, 'finished', 1, ${R.msgU1}, ${R.msgA1}, 3, now())`;
  // Run đang chạy thuộc instance khác, lease còn 1 giờ: không bị sweeper/huỷ chạm trong ca.
  await sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, owner, lease_until) values
    (${R.runLive}, ${L.tid}, ${L.id}, ${R.conv}, ${R.flow2}, 'running', 1, ${R.msgU2}, ${R.msgA2},
     'qc-other-instance', now() + interval '1 hour')`;
}

/** Đổi trạng thái tenant/user như Admin: UPDATE + bump `config_meta` + NOTIFY `config_changed` (sau commit). */
export async function adminChange(
  sql: Sql,
  entity: "tenant" | "user",
  tenantId: string,
  apply: (tx: postgres.TransactionSql) => Promise<unknown>,
): Promise<void> {
  const v = await sql.begin(async (tx) => {
    await apply(tx);
    const [r] = await tx<{ v: number }[]>`update admin.config_meta
      set config_version = config_version + 1 where id = 1 returning config_version as v`;
    return r?.v ?? 1;
  });
  await sql.notify("config_changed", JSON.stringify({ v, entity, tenant_id: tenantId }));
}

// ---------- JWT (EdDSA, claims như Admin: iss `admin`, aud `ai-system`) ----------
export type Keys = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicPem: string;
  other: CryptoKey;
};
export async function makeKeys(): Promise<Keys> {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  const other = (await generateKeyPair("EdDSA")).privateKey;
  return { ...pair, publicPem: await exportSPKI(pair.publicKey), other };
}
export type SignOpts = {
  key?: CryptoKey;
  expS?: number;
  iss?: string;
  aud?: string;
  claims?: Record<string, unknown>;
};
export function sign(k: Keys, who: UserRow, o: SignOpts = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(o.claims ?? { tid: who.tid, role: who.role, sid: null })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-1" })
    .setSubject(who.id)
    .setIssuer(o.iss ?? "admin")
    .setAudience(o.aud ?? "ai-system")
    .setIssuedAt(now - 120)
    .setExpirationTime(now + (o.expS ?? 600))
    .sign(o.key ?? k.privateKey);
}

// ---------- hub-api thật ----------
/**
 * Seam test ↔ hub-api (ghi cho backend-lead, spec-decisions QW-A1): `createApp(cfg, deps)` nhận thêm
 * `{db, redis, jwtPublicKey, appEnv}`; `db` = `connectDb(HUB_API_URL)` (role hub_api), `redis` đã `connect()`.
 */
export type HubDeps = AppDeps & {
  db: Db;
  redis: Redis;
  jwtPublicKey: CryptoKey;
  appEnv: "test";
};
export type Hub = { base: string; db: Db; redis: Redis; stop: () => Promise<void> };

export async function startHub(k: Keys, opts: { redisUrl?: string } = {}): Promise<Hub> {
  const db = connectDb(HUB_API_URL, 5);
  const redis = createRedis(opts.redisUrl ?? REDIS_TEST_URL);
  if (!opts.redisUrl) await redis.connect();
  const deps: HubDeps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
  };
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  return {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    stop: async () => {
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}

// ---------- gọi API ----------
export type CallOpts = { token?: string; body?: unknown; headers?: Record<string, string> };
export type Res = { status: number; headers: Headers; text: string; json: Json };

/** SSE 200 không đọc body (tránh treo); lỗi trước stream là JSON. */
export async function call(hub: Hub, method: string, path: string, o: CallOpts = {}): Promise<Res> {
  const headers = new Headers(o.headers);
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
  const body = o.body === undefined ? undefined : JSON.stringify(o.body);
  if (body !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(`${hub.base}${path}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });
  let text = "";
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream"))
    await res.body?.cancel();
  else text = await res.text();
  let json: Json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

/** Status + body lỗi đúng `CHAT_API_ERRORS` (không chấp nhận 404 text mặc định của Hono). */
export function errorOf(res: Res): { status: number; code: string | undefined } {
  const parsed = ErrorResponseSchema.safeParse(res.json);
  return { status: res.status, code: parsed.success ? parsed.data.error.code : undefined };
}
export const err = (code: ChatErrorCode) => ({ status: CHAT_API_ERRORS[code], code });

/** E5, E7, E10–E15 (C1 plan §2.4) trên tài nguyên cho trước. */
export type Ep = { name: string; method: string; path: string; body?: unknown };
export function endpoints(conv: string, flow: string, run: string): Ep[] {
  return [
    { name: "E5", method: "GET", path: "/conversations" },
    { name: "E7", method: "GET", path: `/conversations/${conv}` },
    { name: "E8", method: "PATCH", path: `/conversations/${conv}`, body: { title: "Đổi tên" } },
    { name: "E10", method: "GET", path: `/conversations/${conv}/flows` },
    { name: "E11", method: "GET", path: `/conversations/${conv}/messages` },
    { name: "E11+flow", method: "GET", path: `/conversations/${conv}/messages?flow_id=${flow}` },
    {
      name: "E12",
      method: "POST",
      path: `/conversations/${conv}/messages`,
      body: { content: "Xin chào" },
    },
    {
      name: "E12+flow",
      method: "POST",
      path: `/conversations/${conv}/messages`,
      body: { content: "Tiếp", flow_id: flow },
    },
    { name: "E13", method: "GET", path: `/runs/${run}/events` },
    { name: "E14", method: "GET", path: `/runs/${run}` },
    { name: "E15", method: "POST", path: `/runs/${run}/cancel` },
    { name: "E9", method: "DELETE", path: `/conversations/${conv}` },
  ];
}

/** Đếm dòng hội thoại (A1/A5: lỗi không được ghi gì). */
export async function counts(sql: Sql): Promise<Record<string, number>> {
  const [r] = await sql<Record<string, number>[]>`select
    (select count(*)::int from hub.conversations) as conversations,
    (select count(*)::int from hub.flows) as flows,
    (select count(*)::int from hub.messages) as messages,
    (select count(*)::int from hub.runs) as runs,
    (select count(*)::int from hub.jobs) as jobs`;
  return r ?? {};
}

/** Chờ theo điều kiện (không sleep cố định): gọi `fn` mỗi 100 ms tới khi `ok` hoặc hết `timeoutMs`; trả lần cuối. */
export async function waitFor<V>(
  fn: () => Promise<V>,
  ok: (v: V) => boolean,
  timeoutMs: number,
): Promise<V> {
  const end = Date.now() + timeoutMs;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await Bun.sleep(100);
    v = await fn();
  }
  return v;
}
