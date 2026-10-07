// HUB-FR-96 · HUB-FR-97 · HUB-FR-98 · HUB-FR-99 · HUB-FR-100 · HUB-FR-102 · HUB-BR-22 · hạ tầng int X2a (test-plan X2a §1–§2):
// DB sạch (`HUB_TEST_DATABASE_URL`) + fixture H1 (tenant/user) + user X2a (`cuc`, `q01…q55`), hub-api thật in-process
// (`createApp`, role `hub_api`, Redis DB 15), có thể dựng 2 instance cùng DB/Redis (plan §13 Q7). Đọc `/me/stream` bằng
// `createSseParser`; mọi frame phải qua `parseMeStreamEvent` (nạp động — contract X2a chưa có lúc viết test).
// Phòng tạo QUA API trong từng `it` (không ở `beforeAll`). Không chứa `it(...)`.
import { expect } from "bun:test";
import { createSseParser } from "@ai/contracts/chat";
import type postgres from "postgres";
import { createApp } from "../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../apps/hub-api/src/lib/db";
import { setSink } from "../../../apps/hub-api/src/lib/logger";
import { createRedis, pingRedis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  errorOf,
  HUB_API_URL,
  type Hub,
  type HubDeps,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  REDIS_TEST_URL,
  type Res,
  type Sql,
  sign,
  T,
  USERS,
  type UserKey,
} from "../H1/_fixtures";

export { call, errorOf, type Json, type Keys, type Res, type Sql, T, USERS };

// ---------- id cố định (dải `a2a0…`) ----------
const x = (n: number) => `a2a00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Bộ sinh uuid tất định cho dữ liệu tạo trong ca (mỗi file một dải `base` ≥ 1000). */
export function idGenX(base: number): () => string {
  let n = base;
  return () => x(n++);
}
export const UNKNOWN_ROOM = x(999_999);

// ---------- người dùng ----------
type Person = {
  id: string;
  tid: string;
  username: string;
  display_name: string;
  role: "member" | "tenant_admin" | "platform_admin";
  locale: "vi" | "en";
  active: boolean;
  locked: boolean;
};
const h1 = (k: UserKey): Person => ({ ...USERS[k], display_name: USERS[k].username });
const qcUser = (i: number): Person => ({
  id: x(100 + i),
  tid: T.acme,
  username: `q${String(i).padStart(2, "0")}`,
  display_name: `QC Người ${String(i).padStart(2, "0")}`,
  role: "member",
  locale: "vi",
  active: true,
  locked: false,
});
/** A = `lan` (chủ G) · B = `hoa` · E = `tam` · C = `cuc` (acme, không thành viên) · D = `an` (beta). */
export const P = {
  lan: h1("lan"),
  hoa: h1("hoa"),
  tam: h1("tam"),
  tadmin: h1("tadmin"),
  an: h1("an"),
  padmin: h1("padmin"),
  khoa: h1("khoa"),
  nghi: h1("nghi"),
  zed: h1("zed"),
  cuc: {
    id: x(1),
    tid: T.acme,
    username: "cuc",
    display_name: "Cúc Lê",
    role: "member",
    locale: "vi",
    active: true,
    locked: false,
  } as Person,
} as const;
export type Who = keyof typeof P;
/** `q01…q55` (acme, dùng được): ROOM_FULL / tranh chấp 50. */
export const Q: Person[] = Array.from({ length: 55 }, (_, i) => qcUser(i + 1));
export const qIds = (from: number, n: number): string[] =>
  Q.slice(from - 1, from - 1 + n).map((q) => q.id);

async function insertX2aUsers(sql: Sql): Promise<void> {
  const rows = [P.cuc, ...Q].map((u) => ({
    id: u.id,
    tenant_id: u.tid,
    username: u.username,
    email: `${u.username}@example.test`,
    password_hash: "x",
    display_name: u.display_name,
    role: u.role,
    locale: u.locale,
    active: u.active,
    locked_by_tenant: u.locked,
    must_change_password: false,
  }));
  await sql`insert into admin.users ${sql(rows)}`;
}

/** DB sạch + fixture H1 + user X2a; xoá `ustream:*` cũ ở Redis test. Trả SQL owner. */
export async function setupX2a(): Promise<Sql> {
  await prepareDb();
  const sql = ownerSql();
  await insertFixture(sql);
  await insertX2aUsers(sql);
  const r = createRedis(REDIS_TEST_URL);
  await r.connect();
  try {
    const keys = await r.keys("ustream:*");
    if (keys.length > 0) await r.del(...keys);
  } finally {
    r.disconnect();
  }
  return sql;
}

// ---------- hub-api thật ----------
/**
 * Seam (plan §7, tasks B6): `pingMs` (mặc định 15000, test 500); `instanceId` khác nhau cho 2 instance. Log bắt qua
 * `setSink` (mẫu H1 `log.int.test.ts`). `redisUrl` khác ⇒ hub có Redis riêng (T16 ngắt Redis của riêng nó).
 */
export type X2aOpts = { pingMs?: number; instanceId?: string; redisUrl?: string };
export type HubX2a = Hub & { instanceId: string };

export async function startHubX2a(k: Keys, o: X2aOpts = {}): Promise<HubX2a> {
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(o.redisUrl ?? REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const instanceId = o.instanceId ?? "qc-x2a-1";
  const deps: HubDeps & { instanceId: string; signal: AbortSignal; pingMs: number } = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId,
    signal: ac.signal,
    pingMs: o.pingMs ?? 500,
  };
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
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

/** Bắt log hub-api (mọi instance trong cùng tiến trình). */
export function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const restore = setSink((_l, line) => lines.push(line));
  return { lines, restore };
}

export type Ctx = { sql: Sql; k: Keys; hub: HubX2a; tok: (w: Who) => Promise<string> };
/** Bộ dựng chung cho file A: DB + khoá + một hub. */
export async function startX2a(o: X2aOpts = {}): Promise<Ctx & { stop: () => Promise<void> }> {
  const sql = await setupX2a();
  const k = await makeKeys();
  const hub = await startHubX2a(k, o);
  return {
    sql,
    k,
    hub,
    tok: (w) => sign(k, P[w]),
    stop: async () => {
      await hub.stop();
      await sql.end();
    },
  };
}
export const tokOf = (k: Keys, p: Person, expS?: number) => sign(k, p, { expS });

// ---------- gọi API ----------
export const api = (hub: Hub, token: string, method: string, path: string, body?: unknown) =>
  call(hub, method, path, { token, body });
export const codeOf = (r: Res) => errorOf(r);
export const e404 = { status: 404, code: "ROOM_NOT_FOUND" };
export const eUser = { status: 404, code: "USER_NOT_FOUND" };
export const e400 = { status: 400, code: "VALIDATION_ERROR" };

let cmSeq = 0;
/** `client_msg_id` tất định (dải riêng, không trùng giữa ca). */
export const cm = (): string => x(500_000 + cmSeq++);

/** Tạo nhóm qua API (A chủ); đòi 201. */
export async function mkGroup(
  hub: Hub,
  token: string,
  memberIds: string[],
  name = "Nhóm G",
): Promise<Json> {
  const r = await api(hub, token, "POST", "/rooms", {
    kind: "group",
    name,
    member_ids: memberIds,
  });
  expect(r.status).toBe(201);
  return r.json;
}
/** Mở DM qua API; đòi 201/200. */
export async function mkDm(hub: Hub, token: string, peerId: string): Promise<Json> {
  const r = await api(hub, token, "POST", "/rooms", { kind: "dm", user_id: peerId });
  expect([200, 201]).toContain(r.status);
  return r.json;
}
/** Gửi tin; đòi 201. */
export async function say(hub: Hub, token: string, roomId: string, content: string): Promise<Json> {
  const r = await api(hub, token, "POST", `/rooms/${roomId}/messages`, {
    content,
    client_msg_id: cm(),
  });
  expect(r.status).toBe(201);
  return r.json;
}
/** `GET /rooms` → mục của phòng `id` (hoặc undefined). */
export async function listItem(hub: Hub, token: string, id: string): Promise<Json> {
  const r = await api(hub, token, "GET", "/rooms?limit=200");
  expect(r.status).toBe(200);
  return (r.json.items as Json[]).find((i) => i.id === id);
}

/** 14 lời gọi `/rooms/:id*` (plan §3). `valid=false` ⇒ body/query sai (người ngoài vẫn phải 404, không 400). */
export type Ep = { name: string; method: string; path: string; body?: unknown };
export function roomEndpoints(id: string, uid: string, valid = true): Ep[] {
  const b = (ok: unknown, bad: unknown) => (valid ? ok : bad);
  return [
    { name: "GET room", method: "GET", path: `/rooms/${id}` },
    {
      name: "PATCH",
      method: "PATCH",
      path: `/rooms/${id}`,
      body: b({ name: "Tên mới" }, { name: "" }),
    },
    { name: "DELETE", method: "DELETE", path: `/rooms/${id}` },
    {
      name: "POST members",
      method: "POST",
      path: `/rooms/${id}/members`,
      body: b({ user_ids: [uid] }, { user_ids: [] }),
    },
    {
      name: "DELETE member",
      method: "DELETE",
      path: `/rooms/${id}/members/${valid ? uid : "khong-phai-uuid"}`,
    },
    { name: "leave", method: "POST", path: `/rooms/${id}/leave` },
    {
      name: "transfer",
      method: "POST",
      path: `/rooms/${id}/transfer`,
      body: b({ user_id: uid }, { user_id: "x" }),
    },
    { name: "hide", method: "POST", path: `/rooms/${id}/hide` },
    {
      name: "GET messages",
      method: "GET",
      path: `/rooms/${id}/messages${valid ? "" : "?limit=0"}`,
    },
    { name: "GET messages limit", method: "GET", path: `/rooms/${id}/messages?limit=1` },
    {
      name: "GET messages before",
      method: "GET",
      path: `/rooms/${id}/messages?before_seq=${valid ? 2 : "abc"}`,
    },
    {
      name: "POST messages",
      method: "POST",
      path: `/rooms/${id}/messages`,
      body: b({ content: "Người ngoài gửi", client_msg_id: cm() }, { content: "" }),
    },
    { name: "read", method: "POST", path: `/rooms/${id}/read`, body: b({ seq: 1 }, { seq: -1 }) },
    { name: "read clamp", method: "POST", path: `/rooms/${id}/read`, body: b({ seq: 999 }, {}) },
  ];
}
/** Gọi mọi endpoint, trả `{name: {status, code}}` để so một lần. */
export async function hitAll(hub: Hub, token: string, eps: Ep[]): Promise<Record<string, Json>> {
  const out: Record<string, Json> = {};
  for (const e of eps)
    out[`${e.method} ${e.name}`] = codeOf(await api(hub, token, e.method, e.path, e.body));
  return out;
}
export const all = (eps: Ep[], v: Json): Record<string, Json> =>
  Object.fromEntries(eps.map((e) => [`${e.method} ${e.name}`, v]));

/** "DB không đổi": hàng `rooms` + `room_members` + đếm/max seq tin (owner). */
export async function roomState(sql: Sql, id: string): Promise<Json> {
  const room = await sql`select * from hub.rooms where id = ${id}`;
  const members = await sql`select * from hub.room_members where room_id = ${id} order by user_id`;
  const [m] = await sql`select count(*)::int as n, coalesce(max(seq), 0)::int as max
    from hub.room_messages where room_id = ${id}`;
  return JSON.parse(JSON.stringify({ room, members, m }));
}

// ---------- /me/stream ----------
export type MeEv = { id: string | null; event: string; data: Json; raw: string; valid: boolean };
export type MeStream = {
  status: number;
  headers: Headers;
  json: Json;
  events: MeEv[];
  /** Văn bản thô đã nhận (kiểm `: ping`). */
  text: () => string;
  until: (pred: (e: MeEv) => boolean, ms?: number) => Promise<MeEv | undefined>;
  /** Resolve khi server đóng stream (hoặc client huỷ). */
  closed: Promise<void>;
  isClosed: () => boolean;
  close: () => void;
};

// biome-ignore lint/suspicious/noExplicitAny: contract X2a nạp động (chưa có lúc viết test)
type ParseFn = (event: string, data: string) => any;
let parseFn: ParseFn | null | undefined;
async function loadParse(): Promise<ParseFn | null> {
  if (parseFn !== undefined) return parseFn;
  const mod = (await import("@ai/contracts/chat")) as Record<string, unknown>;
  parseFn =
    typeof mod.parseMeStreamEvent === "function" ? (mod.parseMeStreamEvent as ParseFn) : null;
  return parseFn;
}

/** Mở `GET /me/stream` (token ở header; `lastId` ⇒ header `Last-Event-ID`). Không SSE ⇒ body JSON. */
export async function openMeStream(
  hub: Hub,
  token: string | null,
  o: { lastId?: string; path?: string; headers?: Record<string, string> } = {},
): Promise<MeStream> {
  const parse = await loadParse();
  const ac = new AbortController();
  const headers = new Headers(o.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (o.lastId !== undefined) headers.set("last-event-id", o.lastId);
  const res = await fetch(`${hub.base}${o.path ?? "/me/stream"}`, { headers, signal: ac.signal });
  const events: MeEv[] = [];
  let raw = "";
  let json: Json;
  let done = false;
  let closed: Promise<void> = Promise.resolve();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream") && res.body) {
    const feed = createSseParser((e) => {
      let data: Json;
      try {
        data = JSON.parse(e.data);
      } catch {
        data = e.data;
      }
      const valid = parse !== null && parse(e.event, e.data) !== null;
      events.push({ id: e.id, event: e.event, data, raw: e.data, valid });
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    closed = (async () => {
      try {
        for (;;) {
          const { done: d, value } = await reader.read();
          if (d) break;
          const s = dec.decode(value, { stream: true });
          if (raw.length < 200_000) raw += s;
          feed(s);
        }
      } catch {
        // abort/đứt
      } finally {
        done = true;
      }
    })();
  } else {
    done = true;
    const t = await res.text();
    try {
      json = t ? JSON.parse(t) : undefined;
    } catch {
      json = undefined;
    }
  }
  const until = async (pred: (e: MeEv) => boolean, ms = 5_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = events.find(pred);
      if (hit || Date.now() > end || done) return hit ?? events.find(pred);
      await Bun.sleep(20);
    }
  };
  return {
    status: res.status,
    headers: res.headers,
    json,
    events,
    text: () => raw,
    until,
    closed,
    isClosed: () => done,
    close: () => ac.abort(),
  };
}

/** Sự kiện thuộc phòng `roomId`. */
export const ofRoom = (s: MeStream, roomId: string) =>
  s.events.filter((e) => e.data && typeof e.data === "object" && e.data.room_id === roomId);
export const msgEv = (content: string) => (e: MeEv) =>
  e.event === "room.message" && e.data?.message?.content === content;

/**
 * Sentinel "không sự kiện": người xem tự gửi một tin vào phòng nhóm riêng (chỉ mình) — nhận được tin này ⇒ mọi sự kiện
 * XADD trước đó cho họ đã tới (Redis Stream giữ thứ tự một khoá). Trả true nếu sentinel tới.
 */
export async function sentinel(
  hub: Hub,
  token: string,
  s: MeStream,
  tag: string,
): Promise<boolean> {
  const solo = await mkGroup(hub, token, [], `Sentinel ${tag}`);
  const text = `SENTINEL-${tag}`;
  await say(hub, token, solo.id, text);
  return (await s.until(msgEv(text), 3_000)) !== undefined;
}

/** Chờ theo điều kiện (không sleep cố định). */
export async function waitUntil(
  ok: () => boolean | Promise<boolean>,
  ms: number,
): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await ok()) return true;
    if (Date.now() > end) return false;
    await Bun.sleep(25);
  }
}

// ---------- DB trực tiếp (role hub_api + GUC) ----------
class Rollback extends Error {}
/** Chạy `fn` trong tx luôn rollback, `SET LOCAL ROLE hub_rw` (tuỳ chọn) + GUC user như `withHubScope`. */
export async function asUser<V>(
  db: Sql,
  who: Person | { tid: string; id: string } | null,
  fn: (tx: postgres.TransactionSql) => Promise<V>,
  o: { role?: boolean; scope?: string; commit?: boolean } = {},
): Promise<V> {
  let out: V | undefined;
  await db
    .begin(async (tx) => {
      if (o.role !== false) await tx`set local role hub_rw`;
      if (who) {
        await tx`select set_config('app.scope', ${o.scope ?? "user"}, true),
          set_config('app.tenant_id', ${who.tid}, true), set_config('app.user_id', ${who.id}, true)`;
      } else if (o.scope) {
        await tx`select set_config('app.scope', ${o.scope}, true)`;
      }
      out = await fn(tx);
      if (!o.commit) throw new Rollback();
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  return out as V;
}
export const pgCode = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "ok",
    (e: { code?: string; message?: string }) => e.code ?? String(e.message ?? e),
  );
export { makeKeys, sign };
