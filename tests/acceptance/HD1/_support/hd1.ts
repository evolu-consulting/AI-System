// HD-FR-01…08 · HD-BR-01…03 · HD-NFR-01…04 · hạ tầng int HD1 (test-plan §1): DB sạch X2a (clone mẫu `test:int:par`, sau N1 T5a/T5 HD1
// có schema `contracts`) + hub-api THẬT in-process (seam `packs`: gói `contracts`, FileBox giả) + admin-api THẬT trên CÙNG DB
// (dùng lại N1 `_support/n1.ts`: `startAdminN1`, `bumpConfig`, `countHops`, `untilHubSettles`, `inPack`) + bộ chụp câu SQL đầy đủ.
// Điều kiện tiền đề (`needContracts`) đỏ NGAY với lý do rõ, không để PostgresError trong fixture. Không chứa `it(...)`.
// Không sleep/poll: chờ tín hiệu hoạt động DB của Hub (`untilHubSettles`, `afterReload`).
//
// Seam test ↔ hub-api (ghi cho backend-lead, test-plan "Cần bổ sung" #1): `createApp(cfg, deps)` nhận `deps.packs = { contracts: true,
// filebox: { url, token } }` (cùng khuôn `pkdemo` của N1). Vắng ⇒ route `/pack/contracts/*` không có ⇒ 404 ⇒ đỏ ở expect.
import { expect } from "bun:test";
import type postgres from "postgres";
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
  REDIS_TEST_URL,
  type Res,
  type Sql,
  sign,
  T,
} from "../../H1/_fixtures";
import {
  type AdminN1,
  bumpConfig,
  type CtxN1,
  countHops,
  type HubN1,
  inPack,
  noFeature,
  P,
  packGroupKey,
  packsPath,
  percentile,
  ROOT,
  startAdminN1,
  untilHubSettles,
} from "../../N1/_support/n1";
import type { HubPa } from "../../P-a/_support/pa";
import { hubActivity } from "../../P-d/d1/_count";
import { setupX2a } from "../../X2a/_x2a";

import { itemId } from "./pure";

export * from "./pure";
export type { CtxN1, Res, Sql };
export { countHops, inPack, noFeature, P, percentile, ROOT, T, untilHubSettles };
// biome-ignore lint/suspicious/noExplicitAny: body JSON của response; mỗi ca tự kiểm
export type Json = any;
type Person = (typeof P)[keyof typeof P];

export const CK = "contracts";
export const CBASE = `/pack/${CK}/contracts`;
export const ROLE_RW = "contracts_rw";

// ---------- DB ----------
export const TABLES = [
  "contracts",
  "contract_items",
  "contract_categories",
  "contract_reminders",
  "contract_events",
  "files",
  "index_outbox",
] as const;
export async function hasContracts(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select
      to_regclass('contracts.contracts') is not null and to_regclass('contracts.contract_items') is not null
      and to_regclass('contracts.contract_categories') is not null and to_regclass('contracts.contract_reminders') is not null
      and to_regclass('contracts.contract_events') is not null and to_regclass('contracts.files') is not null
      and to_regclass('contracts.index_outbox') is not null
      and exists (select 1 from pg_roles where rolname = 'contracts_rw') as ok`;
  return r?.ok === true;
}
export async function needContracts(sql: Sql): Promise<void> {
  expect({ hd1_migrations_pack_contracts: await hasContracts(sql) }).toEqual({
    hd1_migrations_pack_contracts: true,
  });
}
export async function truncateAll(sql: Sql): Promise<void> {
  await sql.unsafe(`truncate ${TABLES.map((t) => `contracts.${t}`).join(", ")}`);
}
const J = (sql: Sql, v: unknown) => sql.json(v as postgres.JSONValue);

export type CRow = {
  id: string;
  tenant: string;
  title?: string;
  kind?: "contract" | "appendix";
  parent?: string | null;
  status?: string;
  direction?: string | null;
  owner?: string | null;
  createdBy?: string;
  updatedAt?: string;
  version?: number;
  fields?: Record<string, unknown>;
  fileId?: string | null;
  source?: string | null;
  handled?: unknown;
};
export async function insContract(sql: Sql, r: CRow): Promise<void> {
  await sql`insert into contracts.contracts
    (id, tenant_id, kind, parent_id, title, direction, status, owner_user_id, created_by, created_at, updated_at, version,
     fields, file_id, source_text, handled)
    values (${r.id}, ${r.tenant}, ${r.kind ?? "contract"}, ${r.parent ?? null}, ${r.title ?? "HĐ"},
      ${r.direction ?? null}, ${r.status ?? "active"}, ${r.owner === undefined ? P.lan.id : r.owner}, ${r.createdBy ?? P.lan.id},
      ${r.updatedAt ?? "2026-01-01T00:00:00Z"}, ${r.updatedAt ?? "2026-01-01T00:00:00Z"}, ${r.version ?? 1},
      ${J(sql, r.fields ?? {})}, ${r.fileId ?? null}, ${r.source ?? null},
      ${r.handled === undefined ? null : J(sql, r.handled)})`;
}
export async function insCategory(sql: Sql, tid: string, id: string, name: string): Promise<void> {
  await sql`insert into contracts.contract_categories (id, tenant_id, name) values (${id}, ${tid}, ${name})`;
}
export async function insItem(
  sql: Sql,
  tid: string,
  contractId: string,
  ord: number,
  o: { id?: string; name?: string; category?: string | null } = {},
): Promise<void> {
  await sql`insert into contracts.contract_items (id, tenant_id, contract_id, ord, name, category_id)
    values (${o.id ?? itemId(ord + Number.parseInt(contractId.slice(-6), 10) * 100)}, ${tid}, ${contractId}, ${ord},
      ${o.name ?? `Hàng ${ord}`}, ${o.category ?? null})`;
}
export async function insEvents(
  sql: Sql,
  tid: string,
  contractId: string,
  n: number,
): Promise<void> {
  await sql`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, at, data)
    select ${tid}, ${contractId}, 'field_edited', ${P.lan.id}, timestamptz '2026-01-01T00:00:00Z' + g * interval '1 minute',
      jsonb_build_object('n', g) from generate_series(1, ${n}::int) g`;
}
export async function insFile(
  sql: Sql,
  tid: string,
  rowId: string,
  fileId: string,
  name = "hd.pdf",
): Promise<void> {
  await sql`insert into contracts.files (id, tenant_id, org, file_id, name, mime, size_bytes, created_by)
    values (${rowId}, ${tid}, ${`t_${tid}`}, ${fileId}, ${name}, 'application/pdf', 10, ${P.lan.id})`;
}

// ---------- hub-api thật (gói contracts) ----------
async function startHubHd1(k: Keys, fb: FbFake): Promise<HubN1> {
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const instanceId = "qc-hd1-1";
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
    packs: { contracts: true, filebox: { url: fb.origin, token: fb.token } },
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

export async function startHd1(): Promise<CtxN1> {
  const sql = await setupX2a();
  const k = await makeKeys();
  const fb = startFbFake();
  const hub = await startHubHd1(k, fb);
  const admin: AdminN1 = await startAdminN1(k);
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
    enable: async (tenantId, key = CK) => {
      const r = await admin.call("PUT", packsPath(tenantId, key));
      expect({ status: r.status }).toEqual({ status: 200 });
      return r.json;
    },
    addToRole: async (tenantId, role, who, key = CK) => {
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

const rolesDone = new WeakMap<CtxN1, Promise<void>>();
/** acme: lan=owner · hoa=editor · tam=viewer · cuc không Group; beta: an=owner. Chờ Hub nạp xong quyền (tín hiệu, không sleep). */
export function ensureRoles(c: CtxN1): Promise<void> {
  let p = rolesDone.get(c);
  if (!p) {
    p = (async () => {
      await c.enable(T.acme);
      await c.enable(T.beta);
      await c.addToRole(T.acme, "owner", [P.lan]);
      await c.addToRole(T.acme, "editor", [P.hoa]);
      await c.addToRole(T.acme, "viewer", [P.tam]);
      await c.addToRole(T.beta, "owner", [P.an]);
      for (const [who, act] of [
        [P.lan, "admin"],
        [P.hoa, "write"],
        [P.tam, "read"],
        [P.an, "admin"],
      ] as const) {
        const got = await untilHubSettles(
          c.hub,
          async () => (await c.hubCall(who, "GET", `/pack/${CK}/me`)).json?.actions ?? [],
          (a: string[]) => a.includes(act),
        );
        expect({ who: who.id, actions: got.includes(act) }).toEqual({ who: who.id, actions: true });
      }
    })();
    rolesDone.set(c, p);
  }
  return p;
}
/** Dọn dữ liệu + Redis quota + FileBox giả; bật quyền (một lần). Đỏ ngay nếu thiếu bảng. */
export async function arrange(c: CtxN1): Promise<void> {
  await needContracts(c.sql);
  await truncateAll(c.sql);
  await clearQuota(c.hub.redis);
  c.fb.reset();
  c.fb.wipe();
  await ensureRoles(c);
}

// ---------- HTTP ----------
export type QueryVal = string | number | readonly string[] | undefined;
export const qs = (q: Record<string, QueryVal>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    if (typeof v === "object") for (const e of v) u.append(k, e);
    else u.append(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
};
export const listOf = (c: CtxN1, p: Person, q: Record<string, QueryVal> = {}) =>
  c.hubCall(p, "GET", `${CBASE}${qs(q)}`);
export const idsOf = (r: Res): string[] => (r.json?.items ?? []).map((i: { id: string }) => i.id);

/** POST multipart `file` (+ trường văn bản). Không theo redirect. */
export async function upload(
  c: CtxN1,
  p: Person,
  o: {
    bytes?: Uint8Array;
    name?: string;
    type?: string;
    fields?: Record<string, string>;
    noFile?: boolean;
    token?: string;
  },
): Promise<Res> {
  const fd = new FormData();
  if (!o.noFile)
    fd.set(
      "file",
      new File([(o.bytes ?? pdf()) as unknown as BlobPart], o.name ?? "hd.pdf", {
        type: o.type ?? "application/pdf",
      }),
    );
  for (const [k, v] of Object.entries(o.fields ?? {})) fd.set(k, v);
  const res = await fetch(`${c.hub.base}${CBASE}`, {
    method: "POST",
    headers: { authorization: `Bearer ${o.token ?? (await c.tok(p))}` },
    body: fd,
  });
  const text = await res.text();
  let json: Json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

// ---------- byte mẫu ----------
let seq = 0;
const enc = new TextEncoder();
/** PDF tối thiểu, mỗi lần nội dung khác nhau. */
export const pdf = (extra = 0): Uint8Array =>
  enc.encode(`%PDF-1.4\n% hd1 #${seq++}\n${"x".repeat(extra)}\n%%EOF\n`);
export const jpeg = (): Uint8Array =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    16,
    0x4a,
    0x46,
    0x49,
    0x46,
    0,
    1,
    seq++ & 255,
    0xff,
    0xd9,
  ]);
export const png = (): Uint8Array =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    seq++ & 255,
  ]);
export const exe = (): Uint8Array =>
  new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0, seq++ & 255]);
/** Tệp `mb` MiB, mở đầu bằng `%PDF-` (qua kiểm magic bytes, vượt/không vượt trần). */
export const bigPdf = (mb: number): Uint8Array => {
  const b = new Uint8Array(Math.floor(mb * 1024 * 1024));
  b.set(enc.encode("%PDF-1.4\n"), 0);
  return b;
};

// ---------- Redis: quota + đếm lệnh ----------
export const QUOTA_PREFIX = "q:contracts:";
export async function quotaKeys(redis: Redis): Promise<string[]> {
  return (await redis.keys(`${QUOTA_PREFIX}*`)).sort();
}
export async function clearQuota(redis: Redis): Promise<void> {
  const ks = await quotaKeys(redis);
  if (ks.length > 0) await redis.del(...ks);
}
/** Giá trị bộ đếm của khoá đầu tiên có tiền tố (tenant `t:<tid>:` hoặc toàn hệ thống `g:`); 0 nếu chưa có. */
export async function quotaOf(
  redis: Redis,
  kind: "t" | "g",
  tid?: string,
): Promise<{ key: string | null; n: number }> {
  const pre = kind === "t" ? `${QUOTA_PREFIX}t:${tid}:` : `${QUOTA_PREFIX}g:`;
  const ks = (await redis.keys(`${pre}*`)).sort();
  const key = ks[0] ?? null;
  return { key, n: key ? Number(await redis.get(key)) : 0 };
}
/** Ngày `YYYY-MM-DD` ở múi `tz` — tính độc lập với code sản phẩm (en-CA = ISO). */
export const dayIn = (tz: string, at = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

type RedisLike = {
  pipeline: (...a: unknown[]) => { exec: (...a: unknown[]) => unknown; length: number };
  multi: (...a: unknown[]) => { exec: (...a: unknown[]) => unknown; length: number };
  sendCommand: (c: { name: string }, ...a: unknown[]) => unknown;
};
/** Đếm Redis của Hub trong `fn`: mỗi pipeline/multi (số lệnh trong nó) + lệnh lẻ NGOÀI pipeline. */
export async function redisOps<R>(
  c: CtxN1,
  fn: () => Promise<R>,
): Promise<{ r: R; pipelines: number[]; single: string[] }> {
  const rl = c.hub.redis as unknown as RedisLike;
  const pipelines: number[] = [];
  const single: string[] = [];
  let inExec = 0;
  const origSend = rl.sendCommand.bind(rl);
  rl.sendCommand = (cmd, ...a) => {
    if (inExec === 0) single.push(cmd.name);
    return origSend(cmd, ...a);
  };
  const wrap = (name: "pipeline" | "multi") => {
    const orig = rl[name].bind(rl);
    rl[name] = (...a: unknown[]) => {
      const p = orig(...a);
      const ex = p.exec.bind(p);
      p.exec = (...b: unknown[]) => {
        pipelines.push(p.length);
        inExec++;
        const out = ex(...b);
        void Promise.resolve(out).finally(() => {
          inExec--;
        });
        return out;
      };
      return p;
    };
    return orig;
  };
  const op = wrap("pipeline");
  const om = wrap("multi");
  try {
    const r = await fn();
    return { r, pipelines, single };
  } finally {
    rl.pipeline = op;
    rl.multi = om;
    rl.sendCommand = origSend as RedisLike["sendCommand"];
  }
}

// ---------- chụp SQL đầy đủ (không cắt 160 ký tự) + EXPLAIN ----------
export type Cap = { text: string; params: unknown[] };
const TX_CTL =
  /^\s*((begin|commit|rollback|savepoint|release)\b|select set_config\('app\.scope'|select b\.oid, b\.typarray from pg_catalog\.pg_type|select "(hub_)?config_version" from "(admin|hub)"\."config_meta")/i;
type PoolOpts = {
  debug?: (conn: number, q: string, params: unknown[], ...rest: unknown[]) => void;
};
export async function captureSql<R>(
  c: CtxN1,
  fn: () => Promise<R>,
): Promise<{ r: R; queries: Cap[] }> {
  hubActivity(c.hub as unknown as HubPa); // cài tap một lần TRƯỚC khi ta bọc (để khôi phục đúng hàm cũ)
  const opts = ((c.hub.db as Json)?.db?.$client as Json)?.options as PoolOpts | undefined;
  if (!opts) throw new Error("không thấy pool postgres.js của Hub (hub.db.db.$client.options)");
  const prev = opts.debug;
  const queries: Cap[] = [];
  opts.debug = (conn, q, params, ...rest) => {
    if (typeof prev === "function") prev(conn, q, params, ...rest);
    if (!TX_CTL.test(q)) queries.push({ text: q, params: params ?? [] });
  };
  try {
    const r = await fn();
    return { r, queries };
  } finally {
    opts.debug = prev;
  }
}
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  if (Array.isArray(v))
    return `'{${v.map((e) => `"${String(e).replace(/(["\\])/g, "\\$1")}"`).join(",")}}'`;
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
/** Thay `$n` bằng literal (kế hoạch tuỳ chỉnh với hằng, không cần biết kiểu tham số). */
export const literalize = (cap: Cap): string =>
  cap.text.replace(/\$(\d+)/g, (_m, n: string) => lit(cap.params[Number(n) - 1]));
type PlanNode = { "Node Type": string; "Relation Name"?: string; Plans?: PlanNode[] };
export function seqScansIn(node: PlanNode, rels: readonly string[]): string[] {
  const own =
    node["Node Type"] === "Seq Scan" &&
    node["Relation Name"] &&
    rels.includes(node["Relation Name"])
      ? [node["Relation Name"]]
      : [];
  return own.concat(...(node.Plans ?? []).map((p) => seqScansIn(p, rels)));
}
/** `EXPLAIN` câu đã chụp, chạy bằng role gói + tenant (RLS thật). Trả danh sách quan hệ bị `Seq Scan`. */
export async function seqScansOf(
  tid: string,
  cap: Cap,
  rels: readonly string[] = ["contracts", "contract_items"],
): Promise<string[]> {
  return inPack(
    tid,
    async (tx) => {
      const rows = (await tx.unsafe(`explain (format json) ${literalize(cap)}`)) as unknown as {
        "QUERY PLAN": { Plan: PlanNode }[];
      }[];
      const plan = rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
      if (!plan) throw new Error("EXPLAIN không trả kế hoạch");
      return seqScansIn(plan, rels);
    },
    ROLE_RW,
  );
}

// ---------- đo ----------
/** D2-48: làm nóng = số kết nối pool Hub + 2 (mỗi kết nối chuẩn bị xong câu trước cửa sổ đo); đọc từ pool thật. */
export function warmRounds(hub: HubN1): number {
  const max = Number(((hub.db as Json)?.db?.$client as Json)?.options?.max);
  return (Number.isFinite(max) && max > 0 ? max : 8) + 2;
}
export const PERF_N = Number(process.env.HD1_PERF_N ?? 200);
export type Stat = { n: number; p50: number; p95: number; max: number };
/** Làm nóng rồi đo `n` lượt tuần tự; mọi lượt phải trả `okStatus`. Token ký sẵn (không tính ký JWT vào thời gian). */
export async function measure(
  c: CtxN1,
  one: (i: number) => Promise<Res>,
  o: { n?: number; okStatus?: number; before?: (i: number) => Promise<void> } = {},
): Promise<Stat> {
  const n = o.n ?? PERF_N;
  const ok = o.okStatus ?? 200;
  for (let i = 0; i < warmRounds(c.hub); i++) {
    await o.before?.(-1 - i);
    const r = await one(-1 - i);
    if (r.status !== ok) throw new Error(`làm nóng ⇒ ${r.status} ${r.text.slice(0, 160)}`);
  }
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    await o.before?.(i);
    const t0 = performance.now();
    const r = await one(i);
    ms.push(performance.now() - t0);
    if (r.status !== ok) throw new Error(`lượt ${i} ⇒ ${r.status} ${r.text.slice(0, 160)}`);
  }
  return { n, p50: percentile(ms, 50), p95: percentile(ms, 95), max: Math.max(...ms) };
}
/** GET với token ký sẵn (không ký JWT mỗi lượt). */
export async function getWith(c: CtxN1, token: string, path: string): Promise<Res> {
  const res = await fetch(`${c.hub.base}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "manual",
  });
  const text = await res.text();
  let json: Json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}
export async function jsonWith(
  c: CtxN1,
  token: string,
  method: string,
  path: string,
  body: unknown,
): Promise<Res> {
  const res = await fetch(`${c.hub.base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}
