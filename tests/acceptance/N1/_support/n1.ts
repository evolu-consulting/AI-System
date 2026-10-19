// PK-FR-02…09 · PK-BR-01 · PK-NFR-01/05 · hạ tầng int N1 (test-plan §1): DB sạch X2a (fixture H1 + user X2a; DB clone mẫu
// `test:int:par` — sau T5a có schema gói) + hub-api THẬT in-process (seam `packs`: gói `pkdemo`, FileBox giả) + admin-api THẬT
// in-process trên CÙNG DB (route `packs`) + bộ đếm "bước nhảy" (câu SQL / lệnh Redis / HTTP). Điều kiện tiền đề (`needPackKit`)
// đỏ NGAY với lý do rõ, không để PostgresError trong fixture. Không chứa `it(...)`. Không sleep/poll: chờ tín hiệu hoạt động DB.
//
// Seam test ↔ hub-api (ghi cho backend-lead, test-plan "Cần bổ sung" #1): `createApp(cfg, deps)` nhận thêm
// `deps.packs = { pkdemo: true, filebox?: { url, token } }`. Vắng ⇒ route `/pack/*` không có ⇒ 404 ⇒ đỏ ở expect.
import { expect } from "bun:test";
import { createDb } from "@ai/db";
import postgres from "postgres";
import { createApp as createHubApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis, type Redis } from "../../../../apps/hub-api/src/lib/redis";
import { type FbFake, startFbFake } from "../../FB1/_fbfake";
import {
  call,
  HUB_API_URL,
  type HubDeps,
  type Keys,
  makeKeys,
  OWNER_URL,
  REDIS_TEST_URL,
  type Res,
  type Sql,
  sign,
  T,
  withCreds,
} from "../../H1/_fixtures";
import type { HubPa } from "../../P-a/_support/pa";
import { hubActivity } from "../../P-d/d1/_count";
import { P, setupX2a } from "../../X2a/_x2a";
import { loadPackContract, noFeature, ROOT } from "./load";

export type { Res, Sql };
export { call, HUB_API_URL, noFeature, OWNER_URL, P, ROOT, T, withCreds };
// biome-ignore lint/suspicious/noExplicitAny: body JSON của response; mỗi ca tự kiểm
export type Json = any;
type Person = (typeof P)[keyof typeof P];

/** Đường dẫn route admin-api (plan §2). TRANH CHẤP: code admin-api mount `/admin/tenants/…`, plan/spec ghi `/api/v1/tenants/…`
 *  (xem tasks.md "Tranh chấp test"). Một hằng ở đây — đổi một dòng khi chốt. */
export const ADMIN_PACKS_BASE = "/api/v1/tenants";
export const packsPath = (tenantId: string, key?: string): string =>
  `${ADMIN_PACKS_BASE}/${tenantId}/packs${key ? `/${key}` : ""}`;

/** Vai trong gói `pkdemo` (acme): lan=owner · hoa=editor · tam=viewer · cuc=không Group · nghi=viewer nhưng inactive. */
export const ROLE_OF = { owner: P.lan, editor: P.hoa, viewer: P.tam } as const;
export type PackRole = keyof typeof ROLE_OF;
export const PK = "pkdemo";
export const packGroupKey = (k: string, r: string): string => `${k.replaceAll("_", "-")}-${r}`;
export const packFeatureKey = (k: string, a: string): string => `${k.replaceAll("_", "-")}-${a}`;

// ---------- DB ----------
/** Gói khung + `pkdemo` đã có trong DB mẫu (T5a). Đỏ ngay (expect) khi thiếu — không PostgresError. */
export async function hasPackKit(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select
      to_regclass('packs.registry') is not null and to_regclass('pkdemo.items') is not null
      and to_regclass('pkdemo.item_lines') is not null and to_regclass('pkdemo.files') is not null
      and to_regclass('pkdemo.index_outbox') is not null
      and exists (select 1 from pg_roles where rolname = 'pkdemo_rw') as ok`;
  return r?.ok === true;
}
export async function needPackKit(sql: Sql): Promise<void> {
  expect({ packKit_migrations_packs_pkdemo: await hasPackKit(sql) }).toEqual({
    packKit_migrations_packs_pkdemo: true,
  });
}

/** Kết nối `hub_api` mới (một kết nối) — đúng đường chạy thật: `SET ROLE <k>_rw` trong tx (D-06). */
export function hubApiSql(): Sql {
  return postgres(HUB_API_URL, { max: 1, onnotice: () => {} });
}
/** Chạy `fn` trong tx của `hub_api` đã `set_config('role', '<k>_rw')` + tenant (`null` = KHÔNG đặt `app.tenant_id`). */
export async function inPack<R>(
  tenantId: string | null,
  fn: (tx: Sql) => Promise<R>,
  role = `${PK}_rw`,
): Promise<R> {
  const conn = hubApiSql();
  try {
    return (await conn.begin(async (tx) => {
      await tx`select set_config('role', ${role}, true)`;
      if (tenantId !== null) await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx as unknown as Sql);
    })) as R;
  } finally {
    await conn.end({ timeout: 1 });
  }
}
/** Mã SQLSTATE của lỗi `fn` ném (hoặc null). */
export async function pgCode(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? `no-code:${(e as Error).message}`;
  }
}

// ---------- id cố định (dải `a5e1…`) ----------
const x = (n: number) => `a5e10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ID = {
  itemA: x(1), // pkdemo.items của acme
  lineA: x(2),
  itemB: x(3), // của beta
  lineB: x(4),
  fileA: x(5),
  fileB: x(6),
  ghost: x(99),
} as const;

/** Chèn cha–con của một tenant (owner, bỏ RLS). */
export async function seedItem(sql: Sql, tid: string, itemId: string, lineId: string, title = "H") {
  await sql`insert into pkdemo.items (id, tenant_id, title) values (${itemId}, ${tid}, ${title})`;
  await sql`insert into pkdemo.item_lines (id, tenant_id, item_id, text)
    values (${lineId}, ${tid}, ${itemId}, 'dòng 1')`;
}
export async function seedFile(sql: Sql, tid: string, rowId: string, fileId: string, org?: string) {
  await sql`insert into pkdemo.files (id, tenant_id, org, file_id, name, mime, size_bytes, created_by)
    values (${rowId}, ${tid}, ${org ?? `t_${tid}`}, ${fileId}, 'hd.pdf', 'application/pdf', 10, ${P.lan.id})`;
}

// ---------- hub-api thật ----------
export type HubN1 = {
  base: string;
  db: ReturnType<typeof connectDb>;
  redis: Redis;
  instanceId: string;
  stop: () => Promise<void>;
};
export async function startHubN1(
  k: Keys,
  o: { fb?: FbFake; pkdemo?: boolean } = {},
): Promise<HubN1> {
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const instanceId = "qc-n1-1";
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId,
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 2,
    packs: {
      pkdemo: o.pkdemo ?? true,
      ...(o.fb ? { filebox: { url: o.fb.origin, token: o.fb.token } } : {}),
    },
  } as HubDeps & Record<string, unknown>;
  const app = createHubApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  return {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    instanceId,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}

// ---------- admin-api thật (cùng DB, role admin_api) ----------
export type AdminN1 = {
  call: (method: string, path: string, body?: unknown, token?: string) => Promise<Res>;
  close: () => Promise<void>;
};
export async function startAdminN1(k: Keys): Promise<AdminN1> {
  const { createApp } = (await import(`${ROOT}/apps/admin-api/src/app.ts`)) as {
    createApp: (
      cfg: unknown,
      deps: unknown,
    ) => { fetch: (r: Request) => Response | Promise<Response> };
  };
  const database = createDb(withCreds(OWNER_URL, "admin_api", "admin_api_dev_pw"), { max: 4 });
  const app = createApp(
    { version: "0.0.0-test", corsOrigins: ["http://localhost:3000"] },
    {
      db: database,
      keys: { privateKey: k.privateKey, publicKey: k.publicKey, kid: "test-1" },
      appEnv: "test",
      dummyHash: "x",
      now: () => new Date(),
    },
  );
  return {
    call: async (method, path, body, token) => {
      const headers = new Headers();
      headers.set("authorization", `Bearer ${token ?? (await sign(k, P.padmin))}`);
      if (body !== undefined) headers.set("content-type", "application/json");
      const res = await app.fetch(
        new Request(`http://localhost${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      const text = await res.text();
      let json: Json;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      return { status: res.status, headers: res.headers, text, json };
    },
    close: async () => {
      await database.close();
    },
  };
}

// ---------- ngữ cảnh ----------
export type CtxN1 = {
  sql: Sql;
  k: Keys;
  hub: HubN1;
  fb: FbFake;
  admin: AdminN1;
  tok: (p: Person) => Promise<string>;
  /** Gọi hub-api bằng persona. */
  hubCall: (p: Person, method: string, path: string, body?: unknown) => Promise<Res>;
  /** Bật gói cho tenant qua admin-api (đòi 200). */
  enable: (tenantId: string, key?: string) => Promise<Json>;
  /** Thêm user vào Group vai (owner SQL) + bump `config_version` + NOTIFY `config_changed` (đúng đường admin-api ghi). */
  addToRole: (tenantId: string, role: PackRole, who: Person[], key?: string) => Promise<void>;
  stop: () => Promise<void>;
};
export async function startN1(o: { pkdemo?: boolean } = {}): Promise<CtxN1> {
  const sql = await setupX2a();
  const k = await makeKeys();
  const fb = startFbFake();
  const hub = await startHubN1(k, { fb, pkdemo: o.pkdemo });
  const admin = await startAdminN1(k);
  const tok = (p: Person) => sign(k, p);
  const ctx: CtxN1 = {
    sql,
    k,
    hub,
    fb,
    admin,
    tok,
    hubCall: async (p, method, path, body) =>
      call(hub, method, path, { token: await tok(p), body }),
    enable: async (tenantId, key = PK) => {
      const r = await admin.call("PUT", packsPath(tenantId, key));
      expect({ status: r.status }).toEqual({ status: 200 });
      return r.json;
    },
    addToRole: async (tenantId, role, who, key = PK) => {
      const [g] = await sql<{ id: string }[]>`select id from admin.groups
        where tenant_id = ${tenantId} and key = ${packGroupKey(key, role)}`;
      expect({ group: packGroupKey(key, role), found: g !== undefined }).toEqual({
        group: packGroupKey(key, role),
        found: true,
      });
      await sql`insert into admin.group_members ${sql(
        who.map((p) => ({ tenant_id: tenantId, group_id: g?.id as string, user_id: p.id })),
      )} on conflict do nothing`;
      await bumpConfig(sql, tenantId);
    },
    stop: async () => {
      await hub.stop();
      await admin.close();
      await fb.close();
      await sql.end();
    },
  };
  return ctx;
}

/** Tăng `admin.config_meta.config_version` + `pg_notify('config_changed', …)` (khuôn helper ghi của admin-api, M3). */
export async function bumpConfig(sql: Sql, tenantId: string): Promise<void> {
  const [r] = await sql<{ v: number }[]>`update admin.config_meta
    set config_version = config_version + 1 returning config_version as v`;
  await sql`select pg_notify('config_changed',
    json_build_object('v', ${r?.v ?? 1}::int, 'entity', 'group', 'tenant_id', ${tenantId}::text)::text)`;
}

// ---------- chờ theo tín hiệu (không sleep/poll) ----------
/** Lặp: đo `probe`; chưa đạt ⇒ chờ Hub gửi câu SQL kế (`hubActivity`: nạp lại cache sau NOTIFY) rồi đo lại. `ms` chỉ là lưới
 *  an toàn (spec: ≤ 5 s). Hết lưới ⇒ trả giá trị cuối để `expect` báo lệch. */
export async function untilHubSettles<V>(
  hub: HubN1,
  probe: () => Promise<V>,
  ok: (v: V) => boolean,
  ms = 5_000,
): Promise<V> {
  const act = hubActivity(hub as unknown as HubPa);
  const end = Date.now() + ms;
  for (;;) {
    let v = await probe();
    if (ok(v)) return v;
    const seen = act.tick();
    v = await probe();
    if (ok(v)) return v;
    const left = end - Date.now();
    if (left <= 0) return v;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<void>((r) => {
      timer = setTimeout(r, left); // lưới an toàn, không phải cơ chế chờ
    });
    try {
      await Promise.race([act.after(seen), guard]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Chạy `trigger` (ghi + NOTIFY) rồi đợi Hub gửi câu SQL đầu tiên sau đó (nạp lại cache) — tín hiệu "bắt đầu nạp". */
export async function afterReload(
  hub: HubN1,
  trigger: () => Promise<void>,
  ms = 5_000,
): Promise<void> {
  const act = hubActivity(hub as unknown as HubPa);
  const seen = act.tick();
  await trigger();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<void>((r) => {
    timer = setTimeout(r, ms); // lưới an toàn
  });
  try {
    await Promise.race([act.after(seen), guard]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- đếm bước nhảy (PK-BR-01 · PK-NFR-05) ----------
export type Hops = {
  sql: number;
  queries: string[];
  redis: string[];
  http: string[];
  httpExt: string[];
};
type RedisLike = { sendCommand: (c: { name: string }, ...a: unknown[]) => unknown };
/** Chạy `fn` và đếm: câu SQL của pool hub (trừ điều khiển tx), lệnh Redis của client hub, `fetch` ra ngoài tiến trình test
 *  (loại lời gọi vào chính hub; `externalOrigins` = dịch vụ ngoài được phép, vd FileBox ⇒ `httpExt`; còn lại = HTTP NỘI BỘ). */
export async function countHops<R>(
  c: CtxN1,
  fn: () => Promise<R>,
  externalOrigins: string[] = [],
): Promise<Hops & { r: R }> {
  const { countQueries } = await import("../../P-d/d1/_count");
  const redis: string[] = [];
  const rl = c.hub.redis as unknown as RedisLike;
  const origSend = rl.sendCommand.bind(rl);
  rl.sendCommand = (cmd, ...a) => {
    redis.push(cmd.name);
    return origSend(cmd, ...a);
  };
  const http: string[] = [];
  const httpExt: string[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!u.startsWith(c.hub.base)) {
      (externalOrigins.some((o) => u.startsWith(o)) ? httpExt : http).push(
        u.split("?")[0] as string,
      );
    }
    return origFetch(input, init);
  }) as typeof fetch;
  try {
    const q = await countQueries(c.hub as unknown as HubPa, fn);
    return { sql: q.n, queries: q.queries, redis, http, httpExt, r: q.r };
  } finally {
    globalThis.fetch = origFetch;
    rl.sendCommand = origSend as RedisLike["sendCommand"];
  }
}

// ---------- body mẫu pkdemo (TRANH CHẤP/CẦN BỔ SUNG #2: hình body chưa có trong contract — một chỗ ở đây) ----------
export const itemBody = (title: string, nLines: number, extra: Json = {}): Json => ({
  title,
  lines: Array.from({ length: nLines }, (_, i) => ({ text: `dòng ${i + 1}` })),
  ...extra,
});
export const percentile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] as number;
};
export { loadPackContract };
