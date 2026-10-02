// ADM-FR-62, ADM-FR-53 · hạ tầng test int M3 (test-plan §1): bọc env M2 (DB test, owner, token), thêm app có `testHooks`
// và/hoặc `Db` tuỳ biến, listener NOTIFY (đóng vai Hub), reset có dữ liệu quyền. Không chứa `it(...)`.
// Module sản phẩm nạp LƯỜI trong hàm dựng app. Request API luôn qua role admin_api; dựng dữ liệu bằng owner.
import { expect } from "bun:test";
import { ConfigChangedPayloadSchema } from "@ai/contracts";
import { createDb, type Db } from "@ai/db";
import postgres from "postgres";
import { makeHashes } from "../M1/_data";
import { ADMIN_API_URL, OWNER_URL } from "../M1/_fixtures";
import { loadApp, loadJwt } from "../M1/_modules";
import { ALL_CATALOG, type CatalogParts } from "../M2/_data";
import { type Caller, createM2Env, type M2Env, type Opts, type Res } from "../M2/_fixtures";
import { loadSecretCrypto } from "../M2/_modules";
import { ALL_PERMISSIONS, type PermParts, seedPermissions, TENANT_ID } from "./_data";

export { EXT } from "../M1/_fixtures";
export * from "../M2/_fixtures";
export * from "./_data";

type AppLike = { fetch: (req: Request) => Response | Promise<Response> };
export type Hooks = { afterLock?: (op: string, step: string) => Promise<void> | void };
export type Msg = {
  raw: string;
  at: number;
  payload: ReturnType<typeof ConfigChangedPayloadSchema.parse>;
};

export type Listener = {
  msgs: Msg[];
  /** Chờ tới khi có thông điệp thứ `count` (1-based, tính từ đầu); quá hạn → ném. */
  waitCount: (count: number, ms?: number) => Promise<void>;
  close: () => Promise<void>;
};

const DEADLINE_MS = 1000;

export async function openListener(): Promise<Listener> {
  const sql = postgres(OWNER_URL, { max: 1, onnotice: () => {} });
  const msgs: Msg[] = [];
  const waiters: Array<() => void> = [];
  await sql.listen("config_changed", (raw) => {
    msgs.push({
      raw,
      at: performance.now(),
      payload: ConfigChangedPayloadSchema.parse(JSON.parse(raw)),
    });
    for (const w of waiters.splice(0)) w();
  });
  return {
    msgs,
    waitCount: async (count, ms = DEADLINE_MS) => {
      const end = performance.now() + ms;
      while (msgs.length < count) {
        const left = end - performance.now();
        if (left <= 0)
          throw new Error(`NOTIFY: chờ ${count} thông điệp, chỉ nhận ${msgs.length} sau ${ms} ms`);
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, left);
          waiters.push(() => {
            clearTimeout(t);
            resolve();
          });
        });
      }
    },
    close: async () => {
      await sql.end({ timeout: 1 });
    },
  };
}

export type M3Env = M2Env & {
  /** App tuỳ biến (hook khoá, Db giả); `call` dùng token của env. */
  makeApp: (o?: {
    hooks?: Hooks;
    db?: Db;
  }) => Promise<{ call: Caller; close: () => Promise<void> }>;
  /** Dựng lại dữ liệu: M1 + catalog M2 + quyền M3. */
  reset3: (o?: { catalog?: CatalogParts; perms?: PermParts }) => Promise<void>;
  cfg: () => Promise<number>;
  deadlocks: () => Promise<number>;
  listen: () => Promise<Listener>;
  /** Ghi một sentinel (chắc chắn bump) và chờ nó tới listener; trả các thông điệp nằm trước sentinel kể từ `from`. */
  settle: (lis: Listener, from: number) => Promise<Msg[]>;
  /** admin + `?tenant_id` helper */
  as: (method: string, path: string, body?: unknown) => Promise<Res>;
};

let hashesCache: ReturnType<typeof makeHashes> | undefined;
const hashes = () => {
  hashesCache ??= makeHashes();
  return hashesCache;
};

export async function createM3Env(
  o: { catalog?: CatalogParts; perms?: PermParts } = {},
): Promise<M3Env> {
  const m2 = await createM2Env({ catalog: o.catalog ?? ALL_CATALOG });
  // Bộ quyền mặc định của env; `reset3({perms})` chỉ ghi đè cho đúng lần gọi đó (TC-4: không dính sang lần sau).
  const basePerms = o.perms ?? ALL_PERMISSIONS;
  await seedPermissions(m2.owner, basePerms);
  const closers: Array<() => Promise<void>> = [];
  let sentinelN = 0;

  const makeApp: M3Env["makeApp"] = async (x = {}) => {
    const h = await hashes();
    const jwt = await loadJwt();
    const { createApp } = await loadApp();
    const sc = await loadSecretCrypto();
    const database = x.db ?? createDb(ADMIN_API_URL, { max: 8 });
    const deps: Record<string, unknown> = {
      db: database,
      keys: await jwt.loadJwtKeys(m2.keys.env),
      appEnv: "test",
      dummyHash: h.pw,
      now: m2.clock.now,
      secretKey: sc.parseMasterKey(m2.masterKeyB64),
    };
    if (x.hooks) deps.testHooks = x.hooks;
    const app = createApp(
      { version: "0.0.0", corsOrigins: ["http://localhost:3000"] },
      deps,
    ) as AppLike;
    const close = async () => {
      if (!x.db) await database.close();
    };
    closers.push(close);
    return {
      call: async (method, path, opts: Opts = {}) => {
        const headers = new Headers(opts.headers);
        if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
        const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
        if (body !== undefined) headers.set("content-type", "application/json");
        const res = await app.fetch(
          new Request(`http://localhost${path}`, { method, headers, body }),
        );
        const text = await res.text();
        let json: unknown;
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
        } as Res;
      },
      close,
    };
  };

  const cfg = async () => {
    const [r] = await m2.owner<{ v: number }[]>`select config_version as v from admin.config_meta`;
    return r?.v ?? 0;
  };
  const deadlocks = async () => {
    const [r] = await m2.owner<{ d: number }[]>`select deadlocks::int as d from pg_stat_database
      where datname = current_database()`;
    return r?.d ?? 0;
  };
  const as: M3Env["as"] = async (method, path, body) =>
    m2.call(method, path, { token: await m2.admin(), body });

  const listeners: Listener[] = [];
  const listen = async () => {
    const l = await openListener();
    listeners.push(l);
    return l;
  };
  const settle: M3Env["settle"] = async (lis, from) => {
    sentinelN += 1;
    const res = await as("POST", `/admin/groups?tenant_id=${TENANT_ID.globex}`, {
      key: `sentinel-${sentinelN}`,
      name: { vi: `Sentinel ${sentinelN}` },
    });
    expect(res.status).toBe(201);
    const v = await cfg();
    const start = performance.now();
    // chỉ tìm từ mốc `from` (P12 xoá config_meta nên `v` có thể lặp lại giá trị của thông điệp cũ)
    while (!lis.msgs.some((m, i) => i >= from && m.payload.v === v)) {
      if (performance.now() - start > 2000) throw new Error("NOTIFY: không nhận được sentinel");
      await lis.waitCount(lis.msgs.length + 1, 2000);
    }
    const idx = lis.msgs.findIndex((m, i) => i >= from && m.payload.v === v);
    return lis.msgs.slice(from, idx);
  };

  return {
    ...m2,
    makeApp,
    cfg,
    deadlocks,
    listen,
    settle,
    as,
    reset: async (parts) => {
      await m2.reset(parts);
      await seedPermissions(m2.owner, basePerms);
    },
    reset3: async (x = {}) => {
      await m2.reset(x.catalog ?? ALL_CATALOG);
      await seedPermissions(m2.owner, x.perms ?? basePerms);
    },
    close: async () => {
      for (const l of listeners) await l.close();
      for (const c of closers) await c();
      await m2.close();
    },
  };
}

/** Gọi API bằng token của một user fixture: `const binh = callerOf(env, "acme", "binh"); await binh("GET", "/admin/groups")`. */
export function callerOf(env: M2Env, tenant: string, username: string) {
  return async (method: string, path: string, body?: unknown): Promise<Res> =>
    env.call(method, path, { token: await env.token(tenant, username), body });
}
