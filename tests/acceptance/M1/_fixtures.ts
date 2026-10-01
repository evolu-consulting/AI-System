// ADM-FR-01, ADM-NFR-07 · hạ tầng test int M1 (test-plan §1, §3): DB test, app in-process, đồng hồ, helper gọi API.
// Không chứa `it(...)`. Mọi request API đi qua role admin_api (RLS thật); migrate/seed/reset bằng owner.

import { expect } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { API_ERRORS, type ErrorCode, ErrorResponseSchema } from "@ai/contracts";
import { createDb, type Db, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import { decodeJwt, decodeProtectedHeader, importPKCS8, SignJWT } from "jose";
import postgres from "postgres";
import { type Hashes, insertFixture, makeHashes, PW, SEED_PW, truncateAll } from "./_data";
import { loadApp, loadJwt, loadSeed } from "./_modules";

export * from "./_data";
export type Sql = postgres.Sql;
// biome-ignore lint/suspicious/noExplicitAny: body JSON của response; mỗi test tự parse bằng schema contract
export type Json = any;

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} chưa đặt — chạy \`bun run keys:dev\` rồi \`bun run test:int\``);
  return v;
};

export function withCreds(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

export const OWNER_URL = required("TEST_DATABASE_URL");
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến test tuỳ chọn (suy ra từ TEST_DATABASE_URL khi thiếu)
const ADMIN_API_ENV = process.env.TEST_ADMIN_API_DATABASE_URL;
export const ADMIN_API_URL = ADMIN_API_ENV ?? withCreds(OWNER_URL, "admin_api", "admin_api_dev_pw");

// ---------- khoá JWT ----------
export type TestKeys = {
  privatePem: string;
  publicPem: string;
  kid: string;
  env: { JWT_PRIVATE_KEY: string; JWT_PUBLIC_KEY: string; JWT_KID: string };
};

export function makeKeys(kid = "test-kid"): TestKeys {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    privatePem,
    publicPem,
    kid,
    env: { JWT_PRIVATE_KEY: privatePem, JWT_PUBLIC_KEY: publicPem, JWT_KID: kid },
  };
}

export const decode = (jwt: string) => ({
  header: decodeProtectedHeader(jwt),
  claims: decodeJwt(jwt),
});

export type SignOpts = {
  sub: string;
  aud: string;
  iss?: string;
  claims?: Record<string, unknown>;
  /** giây so với giờ thật */
  iatOffsetS?: number;
  expOffsetS: number;
  privatePem: string;
  kid?: string;
};

/** Ký JWT EdDSA giả mạo/đúng chuẩn bằng jose (test-plan §1 "Giả mạo JWT"). */
export async function signJwt(o: SignOpts): Promise<string> {
  const key = await importPKCS8(o.privatePem, "EdDSA");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...o.claims })
    .setProtectedHeader({ alg: "EdDSA", kid: o.kid ?? "test-kid" })
    .setSubject(o.sub)
    .setIssuer(o.iss ?? "admin")
    .setAudience(o.aud)
    .setIssuedAt(now + (o.iatOffsetS ?? 0))
    .setExpirationTime(now + o.expOffsetS)
    .sign(key);
}

// ---------- đồng hồ ----------
export const T0 = new Date("2026-10-01T09:00:00.000Z");
export type Clock = {
  now: () => Date;
  set: (d: Date | number) => void;
  advance: (ms: number) => void;
  reset: () => void;
};
export function makeClock(): Clock {
  let t = T0.getTime();
  return {
    now: () => new Date(t),
    set: (d) => {
      t = typeof d === "number" ? d : d.getTime();
    },
    advance: (ms) => {
      t += ms;
    },
    reset: () => {
      t = T0.getTime();
    },
  };
}

// ---------- gọi API ----------
export type Opts = {
  token?: string;
  body?: unknown;
  raw?: string;
  cookie?: string;
  headers?: Record<string, string>;
};
export type Res = {
  status: number;
  headers: Headers;
  text: string;
  json: Json;
  cookies: string[];
};
export type Caller = (method: string, path: string, o?: Opts) => Promise<Res>;
type AppLike = { fetch: (req: Request) => Response | Promise<Response> };

export const EXT = { "X-Client": "extension" } as const;

async function doCall(app: AppLike, method: string, path: string, o: Opts): Promise<Res> {
  const headers = new Headers(o.headers);
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
  if (o.cookie) headers.set("cookie", o.cookie);
  const body = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
  if (body !== undefined) headers.set("content-type", "application/json");
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers, body }));
  const text = await res.text();
  let json: Json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    status: res.status,
    headers: res.headers,
    text,
    json,
    cookies: res.headers.getSetCookie(),
  };
}

/** `ai_rt=<giá trị>` từ Set-Cookie (cookie còn giá trị), để gửi lại làm header `cookie`. */
export function cookieOf(res: Res): string | undefined {
  for (const c of res.cookies) {
    const m = /^ai_rt=([^;]+)/.exec(c);
    if (m?.[1]) return `ai_rt=${m[1]}`;
  }
  return undefined;
}
/** Cookie `ai_rt` bị xoá (Max-Age=0). */
export const clearsCookie = (res: Res): boolean =>
  res.cookies.some((c) => /^ai_rt=(;|$)/.test(c) && /Max-Age=0/i.test(c) && /Path=\/auth/i.test(c));

export const sha256 = (token: string): Buffer => createHash("sha256").update(token).digest();

export function expectErr(res: Res, code: ErrorCode): void {
  expect(res.status).toBe(API_ERRORS[code]);
  const body = ErrorResponseSchema.parse(res.json);
  expect(body.error.code).toBe(code);
  expect(res.headers.get("x-request-id")).toBeTruthy();
}

export type Session = {
  res: Res;
  token: string;
  refresh: string | undefined;
  cookie: string | undefined;
  user: Json;
};

// ---------- môi trường test ----------
export type Env = {
  owner: Sql;
  clock: Clock;
  keys: TestKeys;
  hashes: Hashes;
  call: Caller;
  prod: Caller;
  get: (path: string, o?: Opts) => Promise<Res>;
  post: (path: string, o?: Opts) => Promise<Res>;
  patch: (path: string, o?: Opts) => Promise<Res>;
  login: (tenant: string, username: string, password: string, o?: Opts) => Promise<Res>;
  session: (tenant: string, username: string, password: string, o?: Opts) => Promise<Session>;
  /** access token của user fixture (đăng nhập với PW, riêng `admin` dùng SEED_PW). */
  token: (tenant: string, username: string) => Promise<string>;
  makeCaller: (appEnv: string, db?: Db) => Promise<{ call: Caller; close: () => Promise<void> }>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

let hashesCache: Promise<Hashes> | undefined;
const hashes = () => {
  hashesCache ??= makeHashes();
  return hashesCache;
};

/** `fixture:false` = chỉ reset + migrate (B1 tự gọi runSeed). */
export async function createEnv(opts: { fixture?: boolean } = {}): Promise<Env> {
  const withFixture = opts.fixture ?? true;
  const h = await hashes();
  await resetTestDb(OWNER_URL);
  await runMigrations({ url: OWNER_URL, appEnv: "development" });
  const owner = postgres(OWNER_URL, { max: 4, onnotice: () => {} });
  const seed = async () => {
    const s = await loadSeed();
    await s.runSeed({ url: OWNER_URL, adminUsername: "admin", adminPassword: SEED_PW });
    await insertFixture(owner, h);
  };
  if (withFixture) await seed();

  const keys = makeKeys();
  const clock = makeClock();
  const closers: Array<() => Promise<void>> = [];
  const makeCaller: Env["makeCaller"] = async (appEnv, db) => {
    const jwt = await loadJwt();
    const { createApp } = await loadApp();
    const database = db ?? createDb(ADMIN_API_URL, { max: 5 });
    const app = createApp(
      { version: "0.0.0", corsOrigins: ["http://localhost:3000"] },
      {
        db: database,
        keys: await jwt.loadJwtKeys(keys.env),
        appEnv,
        dummyHash: h.pw,
        now: clock.now,
      },
    ) as AppLike;
    const close = async () => {
      if (!db) await database.close();
    };
    closers.push(close);
    return { call: (m, p, o = {}) => doCall(app, m, p, o), close };
  };
  const main = await makeCaller("test");
  const prod = await makeCaller("production");

  const call = main.call;
  const login: Env["login"] = (tenant, username, password, o = {}) =>
    call("POST", "/auth/login", { ...o, body: { tenant_key: tenant, username, password } });
  const session: Env["session"] = async (tenant, username, password, o = {}) => {
    const res = await login(tenant, username, password, o);
    expect(res.status).toBe(200);
    expect(res.json?.status).toBe("authenticated");
    return {
      res,
      token: res.json.access_token,
      refresh: res.json.refresh_token,
      cookie: cookieOf(res),
      user: res.json.user,
    };
  };

  return {
    owner,
    clock,
    keys,
    hashes: h,
    call,
    prod: prod.call,
    get: (p, o) => call("GET", p, o),
    post: (p, o) => call("POST", p, o),
    patch: (p, o) => call("PATCH", p, o),
    login,
    session,
    token: async (tenant, username) =>
      (await session(tenant, username, username === "admin" ? SEED_PW : PW)).token,
    makeCaller,
    reset: async () => {
      await truncateAll(owner);
      await seed();
      clock.reset();
    },
    close: async () => {
      for (const c of closers) await c();
      await owner.end();
    },
  };
}

// ---------- refresh token / role nguy hiểm (owner) ----------
let counter = 0;
export async function insertRefresh(
  owner: Sql,
  o: { userId: string; tenantId: string; client?: "web" | "extension"; expiresInS?: number },
): Promise<{ id: string; token: string; hash: Buffer }> {
  counter += 1;
  const id = `01900000-0000-7000-8000-${String(900000 + counter).padStart(12, "0")}`;
  const token = createHash("sha256").update(`qc-token-${counter}`).digest("base64url");
  const hash = sha256(token);
  await owner`insert into admin.refresh_tokens
    (id, user_id, tenant_id, family_id, token_hash, client, expires_at)
    values (${id}, ${o.userId}, ${o.tenantId}, ${id}, ${hash}, ${o.client ?? "web"},
            now() + make_interval(secs => ${o.expiresInS ?? 3600}))`;
  return { id, token, hash };
}

export const BYPASS_ROLE = "admin_api_bypass_test";
export const OWNER_ROLE = "admin_api_owner_test";

/** Tạo role phụ nguy hiểm (BYPASSRLS | sở hữu bảng admin), chạy `fn(url)`, luôn dọn. */
export async function withDangerRole(
  owner: Sql,
  kind: "bypass" | "owner",
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const role = kind === "bypass" ? BYPASS_ROLE : OWNER_ROLE;
  const cleanup = async () => {
    await owner.unsafe("drop table if exists admin.qc_owned_probe");
    await owner.unsafe(`drop role if exists ${role}`);
  };
  await cleanup();
  try {
    await owner.unsafe(
      `create role ${role} login password 'danger_pw' ${kind === "bypass" ? "bypassrls" : ""}`,
    );
    if (kind === "owner") {
      await owner.unsafe("create table admin.qc_owned_probe (id int)");
      await owner.unsafe(`alter table admin.qc_owned_probe owner to ${role}`);
    }
    await fn(withCreds(OWNER_URL, role, "danger_pw"));
  } finally {
    await cleanup();
  }
}

/** n lần đăng nhập sai liên tiếp → mảng status. */
export async function wrongLogins(
  env: Env,
  tenant: string,
  username: string,
  n: number,
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push((await env.login(tenant, username, "Wrong-Passw0rd-9")).status);
  }
  return out;
}
