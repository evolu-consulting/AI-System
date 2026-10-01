// ADM-FR-10, ADM-FR-50, ADM-NFR-07 · hạ tầng test int M2 (test-plan §1, §3): DB test, app in-process có `secretKey`,
// helper gọi API. Không chứa `it(...)`. Request API luôn qua role admin_api (RLS thật); migrate/seed/reset/đọc bản mã
// bằng owner. Module sản phẩm (secret-crypto, app, jwt) nạp LƯỜI trong hàm dựng app (không nạp lúc import) để các file
// chỉ cần DB (D1/D2) xanh ngay ở T2.
import { expect } from "bun:test";
import { API_ERRORS, type ErrorCode, ErrorResponseSchema } from "@ai/contracts";
import { createDb, type Db, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { insertFixture, makeHashes, PW, SEED_PW } from "../M1/_data";
import {
  ADMIN_API_URL,
  type Clock,
  type Json,
  makeClock,
  makeKeys,
  OWNER_URL,
  type Res,
  type Sql,
  signJwt,
  type TestKeys,
} from "../M1/_fixtures";
import { loadApp, loadJwt, loadSeed } from "../M1/_modules";
import { newMasterKeyB64 } from "./_crypto";
import { type CatalogParts, seedCatalog, truncateCatalog } from "./_data";
import { loadSecretCrypto } from "./_modules";

export * from "../M1/_data";
export {
  ADMIN_API_URL,
  type Json,
  makeKeys,
  newMasterKeyB64,
  OWNER_URL,
  type Res,
  type Sql,
  type TestKeys,
};

export type Opts = {
  token?: string;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
};
export type Caller = (method: string, path: string, o?: Opts) => Promise<Res>;
type AppLike = { fetch: (req: Request) => Response | Promise<Response> };

async function doCall(app: AppLike, method: string, path: string, o: Opts): Promise<Res> {
  const headers = new Headers(o.headers);
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
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

/** Access token ký bằng khoá của app (giả mạo claim): sub = id user, aud 'ai-system'. */
export function signJwtFor(
  env: M2Env,
  sub: string,
  claims: Record<string, unknown>,
): Promise<string> {
  return signJwt({
    sub,
    aud: "ai-system",
    claims,
    expOffsetS: 900,
    privatePem: env.keys.privatePem,
  });
}

export function expectErr(res: Res, code: ErrorCode): void {
  expect(res.status).toBe(API_ERRORS[code]);
  const body = ErrorResponseSchema.parse(res.json);
  expect(body.error.code).toBe(code);
  expect(res.headers.get("x-request-id")).toBeTruthy();
}

export type M2Env = {
  owner: Sql;
  clock: Clock;
  /** khoá chủ (base64) mà app của env này dùng để mã hoá. */
  masterKeyB64: string;
  /** khoá JWT của app (ký token giả mạo trong test). */
  keys: TestKeys;
  call: Caller;
  get: (path: string, o?: Opts) => Promise<Res>;
  post: (path: string, o?: Opts) => Promise<Res>;
  put: (path: string, o?: Opts) => Promise<Res>;
  patch: (path: string, o?: Opts) => Promise<Res>;
  del: (path: string, o?: Opts) => Promise<Res>;
  /** access token của user fixture (admin dùng SEED_PW); cache tới lần `reset()`. */
  token: (tenant: string, username: string) => Promise<string>;
  /** token của platform_admin seed (`platform/admin`). */
  admin: () => Promise<string>;
  makeCaller: (o?: { secretKey?: boolean; db?: Db }) => Promise<{ call: Caller }>;
  reset: (parts?: CatalogParts) => Promise<void>;
  /** owner: id của feature `core` (do seed tạo). */
  coreId: () => Promise<string>;
  close: () => Promise<void>;
};

export type EnvOpts = { catalog?: CatalogParts; masterKeyB64?: string };

let hashesCache: ReturnType<typeof makeHashes> | undefined;
const hashes = () => {
  hashesCache ??= makeHashes();
  return hashesCache;
};

export async function createM2Env(opts: EnvOpts = {}): Promise<M2Env> {
  const h = await hashes();
  await resetTestDb(OWNER_URL);
  await runMigrations({ url: OWNER_URL, appEnv: "development" });
  const owner = postgres(OWNER_URL, { max: 6, onnotice: () => {} });
  const masterKeyB64 = opts.masterKeyB64 ?? newMasterKeyB64();
  let catalog: CatalogParts | undefined = opts.catalog;
  const seed = async () => {
    const s = await loadSeed();
    await s.runSeed({ url: OWNER_URL, adminUsername: "admin", adminPassword: SEED_PW });
    await insertFixture(owner, h);
    if (catalog) await seedCatalog(owner, catalog);
  };
  await seed();

  const keys = makeKeys();
  const clock = makeClock();
  const closers: Array<() => Promise<void>> = [];
  const makeCaller: M2Env["makeCaller"] = async (o = {}) => {
    const jwt = await loadJwt();
    const { createApp } = await loadApp();
    const database = o.db ?? createDb(ADMIN_API_URL, { max: 8 });
    const deps: Record<string, unknown> = {
      db: database,
      keys: await jwt.loadJwtKeys(keys.env),
      appEnv: "test",
      dummyHash: h.pw,
      now: clock.now,
    };
    if (o.secretKey !== false) {
      const sc = await loadSecretCrypto();
      deps.secretKey = sc.parseMasterKey(masterKeyB64);
    }
    const app = createApp(
      { version: "0.0.0", corsOrigins: ["http://localhost:3000"] },
      deps,
    ) as AppLike;
    closers.push(async () => {
      if (!o.db) await database.close();
    });
    return { call: (m, p, x = {}) => doCall(app, m, p, x) };
  };
  const main = await makeCaller();
  const call = main.call;
  let tokens = new Map<string, string>();
  const token: M2Env["token"] = async (tenant, username) => {
    const k = `${tenant}/${username}`;
    const hit = tokens.get(k);
    if (hit) return hit;
    const res = await call("POST", "/auth/login", {
      body: {
        tenant_key: tenant,
        username,
        password: tenant === "platform" && username === "admin" ? SEED_PW : PW,
      },
    });
    expect(res.status).toBe(200);
    const t = res.json.access_token as string;
    tokens.set(k, t);
    return t;
  };

  return {
    owner,
    clock,
    masterKeyB64,
    keys,
    call,
    get: (p, o) => call("GET", p, o),
    post: (p, o) => call("POST", p, o),
    put: (p, o) => call("PUT", p, o),
    patch: (p, o) => call("PATCH", p, o),
    del: (p, o) => call("DELETE", p, o),
    token,
    admin: () => token("platform", "admin"),
    makeCaller,
    reset: async (parts) => {
      if (parts) catalog = parts;
      await truncateCatalog(owner);
      await seed();
      tokens = new Map();
      clock.reset();
    },
    coreId: async () => {
      const [r] = await owner<{ id: string }[]>`select id from admin.features where key = 'core'`;
      if (!r) throw new Error("chưa có feature core");
      return r.id;
    },
    close: async () => {
      for (const c of closers) await c();
      await owner.end();
    },
  };
}

/** Tạo secret bằng API (platform admin); trả `id`. */
export async function apiSecret(env: M2Env, name: string, value: string): Promise<string> {
  const res = await env.post("/admin/secrets", {
    token: await env.admin(),
    body: { name, value },
  });
  expect(res.status).toBe(201);
  return res.json.id as string;
}

/** Các nơi giá trị có thể lộ: quét `forms` (thô/base64/hex) trong từng chuỗi → trả các chuỗi bị lộ. */
export function leaked(haystacks: Record<string, string>, forms: string[]): string[] {
  const out: string[] = [];
  for (const [where, text] of Object.entries(haystacks)) {
    if (forms.some((f) => text.includes(f))) out.push(where);
  }
  return out;
}

/** Quét toàn bộ bảng admin.* + hub.* (row_to_json) → tên bảng có chứa một trong `forms`. */
export async function scanDatabase(owner: Sql, forms: string[]): Promise<string[]> {
  const tables = await owner<{ s: string; t: string }[]>`select table_schema as s, table_name as t
    from information_schema.tables where table_schema in ('admin', 'hub') and table_type = 'BASE TABLE'`;
  const hits: string[] = [];
  for (const { s, t } of tables) {
    const rows = await owner.unsafe(`select row_to_json(x)::text as j from ${s}."${t}" x`);
    const blob = rows.map((r) => String(r.j)).join("\n");
    if (forms.some((f) => blob.includes(f))) hits.push(`${s}.${t}`);
  }
  return hits;
}
