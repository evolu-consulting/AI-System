// HUB-FR-44 · HUB-FR-101 · HUB-BR-21 · HUB-BR-22 · hạ tầng int X2b-2 (test-plan X2b2 §1): DB sạch X2b (fixture H1 + user X2a +
// cấu hình Hub + quyền agent X2b) + kho đính kèm H2c (`attachments` deps: driver local, thư mục tạm riêng, vòng sweeper tắt —
// `sweepOnce` gọi tay, đồng hồ tiêm) + hub-api thật in-process (seam X2a `pingMs` + H1 `jobMaxWaitS` + H2b `maxConcurrentRuns`
// [+ P-a `processEngine` khi cần]). `ScriptRuntime` H1 đóng vai Runtime; endpoint nội bộ gọi bằng token job (`jobFetch`,
// `jobOutput` — đặt `token_hash` như `H2c/_h2c2.ts` `reclaim`). Không directive `#fake:*`, không Dify. Không chứa `it(...)`.
//
// Cột mới của 0023 (`attachments.room_id`, `room_message_id`) đọc qua `to_jsonb(a)->>'col'` ⇒ trước B1 truy vấn vẫn chạy (trả
// rỗng/undefined) và ca đỏ ở `expect`, không ở `PostgresError 42703` (luật "đỏ đúng lý do").
import { expect } from "bun:test";
import { access } from "node:fs/promises";
import { createApp } from "../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../apps/hub-api/src/lib/db";
import { logger } from "../../../apps/hub-api/src/lib/logger";
import { createRedis, pingRedis } from "../../../apps/hub-api/src/lib/redis";
import type { AttachmentStorage } from "../../../apps/hub-api/src/modules/attachments/storage";
import { createLocalStorage } from "../../../apps/hub-api/src/modules/attachments/storage.local";
import { sweepOnce } from "../../../apps/hub-api/src/modules/attachments/sweeper";
import {
  HUB_API_URL,
  type HubDeps,
  type Json,
  type Keys,
  makeKeys,
  REDIS_TEST_URL,
  type Res,
  type Sql,
  sign,
  waitFor,
} from "../H1/_fixtures";
import { AG, testRedis } from "../H1/_hub";
import { type Job, ScriptRuntime } from "../H1/_runtime";
import { newJobToken, tokenHash } from "../H2a/_runtime2";
import { upload as h2cUpload, pathOf, rmDir, tempDir } from "../H2c/_h2c";
import { agentWithOutputs, type BinRes, internalGet, postOutput } from "../H2c/_h2c2";
import { api, type HubX2a, mkGroup, P, type Who } from "../X2a/_x2a";
import { AGB, type CtxB, runtimeUsage, setupX2b } from "../X2b/_x2b";

export type { BinRes, Job, Json, Res, Sql, Who };

// ---------- dựng ----------
/** DB sạch X2b + `hoadon`/`trello` bật `Write` (agent ghi `out/`, như H2c PL9). */
export async function setupX2b2(): Promise<Sql> {
  const sql = await setupX2b();
  await sql`update hub.agents set runtime_options = ${sql.json({ allowed_tools: ["Read", "Grep", "Write"] })}
    where id in (${AG.hoadon}, ${AGB.trello})`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  return sql;
}

export type X2b2Opts = {
  maxConcurrentRuns?: number;
  tenantMaxBytes?: number;
  /** cờ P-a (`processEngine`, vòng nền tắt, `stageLauncher` giả) — chỉ `regress.int`. */
  processEngine?: boolean;
  instanceId?: string;
};
export type HubX2b2 = HubX2a & {
  dir: string;
  storage: AttachmentStorage | null;
  storageError: string | null;
};
export const TENANT_MAX = 5_368_709_120;

/** hub-api thật: deps X2b + `attachments` (kho thư mục tạm riêng; `stop()` xoá thư mục). */
export async function startHubX2b2(k: Keys, o: X2b2Opts = {}): Promise<HubX2b2> {
  const dir = await tempDir("x2b2");
  let storage: AttachmentStorage | null = null;
  let storageError: string | null = null;
  try {
    storage = await createLocalStorage({ dir });
  } catch (e) {
    storageError = e instanceof Error ? e.message : String(e);
  }
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const instanceId = o.instanceId ?? "qc-x2b2-1";
  const pa = o.processEngine
    ? { processEngine: true, processLoops: false, stageLauncher: { kick: async () => {} } }
    : {};
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
    maxConcurrentRuns: o.maxConcurrentRuns ?? 2,
    attachments: storage
      ? { storage, tenantMaxBytes: o.tenantMaxBytes ?? TENANT_MAX, sweepS: 600, sweep: false }
      : undefined,
    ...pa,
  } as HubDeps & Record<string, unknown>;
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  return {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    instanceId,
    dir,
    storage,
    storageError,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
      await rmDir(dir);
    },
  };
}

export type CtxX = CtxB & { hub: HubX2b2 };
export async function startX2b2(o: X2b2Opts = {}): Promise<CtxX> {
  const sql = await setupX2b2();
  const k = await makeKeys();
  const hub = await startHubX2b2(k, o);
  const redis = await testRedis();
  const rt = new ScriptRuntime(sql, redis);
  return {
    sql,
    k,
    hub,
    redis,
    rt,
    tok: (w) => sign(k, P[w]),
    stop: async () => {
      await hub.stop();
      redis.disconnect();
      await sql.end();
    },
  };
}

// ---------- byte mẫu (cố định) ----------
const enc = new TextEncoder();
export const MiB = 1_048_576;
export const KiB = 1024;
/** PDF `%PDF-1.7` + đệm `A` tới đúng `n` byte. */
export function pdf(n: number): Uint8Array {
  const b = new Uint8Array(n).fill(0x41);
  b.set(enc.encode("%PDF-1.7\n"), 0);
  return b;
}
export const text = (s: string): Uint8Array => enc.encode(s);
export const HOADON = () => pdf(MiB);

// ---------- upload / gửi ----------
export async function upload(c: CtxX, who: Who, name: string, bytes: Uint8Array): Promise<Res> {
  return h2cUpload(c.hub, await c.tok(who), bytes, name);
}
/** Upload phải 201 → id. */
export async function uploadId(c: CtxX, who: Who, name: string, bytes: Uint8Array) {
  const r = await upload(c, who, name, bytes);
  expect(r.status).toBe(201);
  return r.json?.id as string;
}
export type SendBody = {
  content: string;
  attachment_ids?: unknown;
  flow_id?: string;
  client_msg_id?: string;
};
export type Sent = { res: Res; runId: string | null; flowId: string | null };
/** POST `/rooms/:id/messages` (thêm `client_msg_id` khi vắng). */
export async function sendRoom(c: CtxX, who: Who, room: string, body: SendBody): Promise<Sent> {
  const res = await api(c.hub, await c.tok(who), "POST", `/rooms/${room}/messages`, {
    client_msg_id: crypto.randomUUID(),
    ...body,
  });
  return { res, runId: res.headers.get("x-run-id"), flowId: res.headers.get("x-flow-id") };
}
/** Gửi tin phòng kèm file: đòi 201 (trước code: 400 strict ⇒ đỏ ở đây). */
export async function sendFiles(
  c: CtxX,
  who: Who,
  room: string,
  content: string,
  ids: string[],
  flowId?: string,
): Promise<Sent> {
  const s = await sendRoom(c, who, room, {
    content,
    attachment_ids: ids,
    ...(flowId ? { flow_id: flowId } : {}),
  });
  expect(s.res.status).toBe(201);
  return s;
}
/** Nhóm qua API (chủ `owner`). */
export async function group(c: CtxX, owner: Who, members: Who[], name: string): Promise<string> {
  const ids = members.map((m) => P[m].id);
  return (await mkGroup(c.hub, await c.tok(owner), ids, name)).id as string;
}
export const call = async (c: CtxX, who: Who, method: string, path: string, body?: unknown) =>
  api(c.hub, await c.tok(who), method, path, body);
export const addMember = (c: CtxX, owner: Who, room: string, w: Who) =>
  call(c, owner, "POST", `/rooms/${room}/members`, { user_ids: [P[w].id] });
export const kick = (c: CtxX, owner: Who, room: string, w: Who) =>
  call(c, owner, "DELETE", `/rooms/${room}/members/${P[w].id}`);
export const leave = (c: CtxX, who: Who, room: string) =>
  call(c, who, "POST", `/rooms/${room}/leave`);
export const deleteRoom = (c: CtxX, owner: Who, room: string) =>
  call(c, owner, "DELETE", `/rooms/${room}`);

// ---------- đọc file (API) ----------
export const getAtt = (c: CtxX, who: Who, id: string) => call(c, who, "GET", `/attachments/${id}`);
/** `GET /attachments/:id/content` (byte thô). */
export async function getContent(c: CtxX, who: Who, id: string): Promise<BinRes> {
  const res = await fetch(`${c.hub.base}/attachments/${id}/content`, {
    headers: { authorization: `Bearer ${await c.tok(who)}` },
    keepalive: false,
    signal: AbortSignal.timeout(20_000),
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const t = new TextDecoder().decode(bytes);
  let json: Json;
  try {
    json = t ? JSON.parse(t) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text: t, json, bytes };
}

// ---------- DB (owner; an toàn trước 0023) ----------
/** Hàng attachment dạng jsonb (cột 0023 vắng ⇒ khoá vắng). */
export async function attCols(sql: Sql, id: string): Promise<Json> {
  const [r] = await sql<
    { j: Json }[]
  >`select to_jsonb(a) as j from hub.attachments a where a.id = ${id}`;
  return r?.j;
}
/** File gắn phòng `roomId` (theo `room_message_id`, `position`). */
export async function roomFiles(sql: Sql, roomId: string): Promise<Json[]> {
  const rows = await sql<{ j: Json }[]>`select to_jsonb(a) as j from hub.attachments a
    where to_jsonb(a)->>'room_id' = ${roomId}
    order by to_jsonb(a)->>'room_message_id', a.position, a.id`;
  return rows.map((r) => r.j);
}
export async function hasColumn(sql: Sql, table: string, col: string): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from information_schema.columns
    where table_schema = 'hub' and table_name = ${table} and column_name = ${col}`;
  return (r?.n ?? 0) === 1;
}
/** `runs.attachment_ids` (thứ tự lưu). */
export async function runFiles(sql: Sql, runId: string): Promise<string[]> {
  const [r] = await sql<
    { ids: string[] }[]
  >`select attachment_ids as ids from hub.runs where id = ${runId}`;
  return r?.ids ?? [];
}
export async function runStatus(sql: Sql, runId: string): Promise<string | undefined> {
  const [r] = await sql<{ s: string }[]>`select status as s from hub.runs where id = ${runId}`;
  return r?.s;
}
export const waitRunStatus = (sql: Sql, runId: string, want: string[], ms = 10_000) =>
  waitFor(
    () => runStatus(sql, runId),
    (s) => want.includes(s ?? ""),
    ms,
  );
/** Nội dung còn trên đĩa kho của hub. */
export async function onDisk(c: CtxX, id: string): Promise<boolean> {
  const row = await attCols(c.sql, id);
  try {
    await access(pathOf(c.hub.dir, String(row?.storage_key ?? "")));
    return true;
  } catch {
    return false;
  }
}
/** Lùi `created_at`/`bound_at` của hàng `ms`. */
export async function age(sql: Sql, id: string, ms: number): Promise<void> {
  await sql`update hub.attachments set created_at = created_at - ${ms} * interval '1 millisecond',
    bound_at = bound_at - ${ms} * interval '1 millisecond' where id = ${id}`;
}
/**
 * Dọn file CHƯA GẮN còn lại của ca (bẫy §1: sweeper toàn cục + H2c A127 đếm `expired`): xoá hàng
 * `message_id IS NULL ∧ room_id IS NULL` (cột 0023 đọc qua jsonb).
 */
export async function dropUnbound(sql: Sql): Promise<void> {
  await sql`delete from hub.attachments a where a.message_id is null and to_jsonb(a)->>'room_id' is null`;
}
/** Kho của hub (lỗi dựng storage ⇒ lỗi `expect`). */
export function storageOf(c: CtxX): AttachmentStorage {
  expect(c.hub.storageError).toBeNull();
  return c.hub.storage as AttachmentStorage;
}
/** Một lượt sweeper (đồng hồ tiêm). Ca X2b2 KHÔNG khẳng định số đếm `SweepResult` (bẫy §1). */
export const sweep = (c: CtxX, now: Date) =>
  sweepOnce({ db: c.hub.db as never, storage: storageOf(c), now, log: logger });

// ---------- Runtime giả: endpoint nội bộ bằng token job ----------
const tokens = new Map<string, string>();
/** Token job như Runtime (đặt `token_hash`; một token mỗi job). */
export async function jobToken(sql: Sql, jobId: string): Promise<string> {
  const have = tokens.get(jobId);
  if (have) return have;
  const t = newJobToken();
  await sql`update hub.jobs set token_hash = ${tokenHash(t)} where id = ${jobId}`;
  tokens.set(jobId, t);
  return t;
}
/** `GET /internal/jobs/:job/attachments/:att` bằng token job (`token` cho trước = dùng nguyên văn). */
export async function jobFetch(c: CtxX, job: Job, attId: string, token?: string): Promise<BinRes> {
  return internalGet(c.hub, job.id, attId, token ?? (await jobToken(c.sql, job.id)));
}
/** `POST /internal/jobs/:job/outputs` (agent ghi `out/<name>`) → kết quả thô. */
export async function jobOutputRaw(c: CtxX, job: Job, name: string, bytes: Uint8Array) {
  return postOutput(c.hub, job.id, await jobToken(c.sql, job.id), name, bytes);
}
/** Như trên, đòi 201 → id output. */
export async function jobOutput(c: CtxX, job: Job, name: string, bytes: Uint8Array) {
  const r = await jobOutputRaw(c, job, name, bytes);
  expect(r.status).toBe(201);
  return r.json?.id as string;
}
/** Kết thúc job `done` kèm `outputs` (contract C2) + usage như Runtime thật. */
export async function finishWith(c: CtxX, job: Job, textOut: string, outputs: string[]) {
  await runtimeUsage(c, job);
  await agentWithOutputs(c.rt, c.sql, job, { status: "done", text: textOut }, outputs);
}
