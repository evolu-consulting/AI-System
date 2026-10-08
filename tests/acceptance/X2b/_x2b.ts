// HUB-FR-101 · HUB-BR-21 · HUB-BR-22 · hạ tầng int X2b (test-plan X2b §2): DB sạch + fixture H1 + user X2a + cấu hình Hub H1
// (`insertHubConfig`) + quyền agent X2b; hub-api thật in-process (seam X2a `pingMs`/`instanceId` + H1 `jobMaxWaitS` + H2b
// `maxConcurrentRuns`); `ScriptRuntime` H1 đóng vai Runtime (provider `fake-cli`, không Dify, không `claude-sub`).
// Phòng tạo QUA API trong từng `it`. Không chứa `it(...)`.
//
// Quyền (plan §9, spec §7): A = `lan` dùng `hoadon` + `trello`; B = `hoa` chỉ `trello` (bỏ grant `hoadon` của H1);
// C = `cuc` có `hoadon` nhưng KHÔNG là thành viên phòng (AC10: có quyền agent vẫn không gọi được). `hoadon` (H1, profile
// fake) thêm entitlement acme; `trello` agent mới (dải `a2bb…`).
//
// Đọc cột mới của migration 0014 (`runs.room_id`, `room_messages.placement`…) qua `to_jsonb(row)->>'col'` ⇒ trước B1 truy vấn
// vẫn chạy (trả rỗng) và ca đỏ ở `expect`, không ở `PostgresError` (Luật "đỏ đúng lý do").
import { expect } from "bun:test";
import { createApp } from "../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis, type Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  HUB_API_URL,
  type HubDeps,
  type Json,
  type Keys,
  makeKeys,
  R,
  REDIS_TEST_URL,
  type Res,
  type Sql,
  sign,
  T,
  waitFor,
} from "../H1/_fixtures";
import { AG, insertHubConfig, testRedis } from "../H1/_hub";
import { type Job, ScriptRuntime } from "../H1/_runtime";
import { endSqlRun } from "../H2a/_h2a2";
import { api, cm, type HubX2a, P, setupX2a, type Who } from "../X2a/_x2a";

export { cm, type Job, type Json, P, type Res, type Sql, type Who, waitFor };

const x = (n: number) => `a2bb0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function idGenB(base: number): () => string {
  let n = base;
  return () => x(n++);
}
export const AGB = { hoadon: AG.hoadon, trello: x(51) } as const;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Quyền agent X2b (cần `insertHubConfig` trước). Tăng `hub_config_version`. */
async function insertX2bAgents(sql: Sql): Promise<void> {
  await sql`insert into hub.agents ${sql({
    id: AGB.trello,
    key: "trello",
    name: sql.json({ vi: "Trello", en: "Trello" }),
    description: "Tạo và cập nhật thẻ Trello của nhóm.",
    runtime: "agentic-cli",
    profile_id: (await sql`select profile_id from hub.agents where id = ${AG.hoadon}`)[0]
      ?.profile_id,
    system_prompt: "",
  })}`;
  await sql`update hub.agents set name = ${sql.json({ vi: "Hoá đơn", en: "Invoice" })},
    description = 'Kiểm tra hoá đơn đầu vào.' where id = ${AG.hoadon}`;
  await sql`insert into hub.agent_entitlements ${sql([
    { agent_id: AGB.hoadon, tenant_id: T.acme },
    { agent_id: AGB.trello, tenant_id: T.acme },
  ])}`;
  await sql`delete from hub.agent_grants
    where agent_id = ${AGB.hoadon} and subject_type = 'user' and subject_id = ${P.hoa.id}`;
  const g = (agent_id: string, who: Who) => ({
    agent_id,
    tenant_id: T.acme,
    subject_type: "user",
    subject_id: P[who].id,
  });
  await sql`insert into hub.agent_grants ${sql([
    g(AGB.trello, "lan"),
    g(AGB.trello, "hoa"),
    g(AGB.hoadon, "cuc"),
  ])}`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

/** DB sạch (X2a) + cấu hình Hub H1 + quyền X2b; kết thúc `runLive` của `lan` (để giới hạn run đo đúng). */
export async function setupX2b(): Promise<Sql> {
  const sql = await setupX2a();
  await insertHubConfig(sql);
  await insertX2bAgents(sql);
  await endSqlRun(sql, R.runLive);
  return sql;
}

export type X2bOpts = { instanceId?: string; maxConcurrentRuns?: number; pingMs?: number };

/** hub-api thật: deps X2a (me-stream) + H1 (`jobMaxWaitS`) + H2b (`maxConcurrentRuns`, mặc định 2). */
export async function startHubX2b(k: Keys, o: X2bOpts = {}): Promise<HubX2a> {
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const instanceId = o.instanceId ?? "qc-x2b-1";
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId,
    signal: ac.signal,
    pingMs: o.pingMs ?? 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: o.maxConcurrentRuns ?? 2,
  } as HubDeps & Record<string, unknown>;
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

export type CtxB = {
  sql: Sql;
  k: Keys;
  hub: HubX2a;
  redis: Redis;
  rt: ScriptRuntime;
  tok: (w: Who) => Promise<string>;
  stop: () => Promise<void>;
};
export async function startX2b(o: X2bOpts = {}): Promise<CtxB> {
  const sql = await setupX2b();
  const k = await makeKeys();
  const hub = await startHubX2b(k, o);
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

// ---------- gửi / đọc ----------
export type Sent = { res: Res; runId: string | null; flowId: string | null };
/** POST tin phòng (body thô); trả header run nếu có. */
export async function post(c: CtxB, who: Who, roomId: string, body: Json): Promise<Sent> {
  const res = await api(c.hub, await c.tok(who), "POST", `/rooms/${roomId}/messages`, {
    client_msg_id: cm(),
    ...body,
  });
  return { res, runId: res.headers.get("x-run-id"), flowId: res.headers.get("x-flow-id") };
}
/** Gọi agent: đòi 201 + `X-Run-Id` uuid (trước code: đỏ ở đây — tin `@` đang là tin thường, không header). */
export async function invoke(
  c: CtxB,
  who: Who,
  roomId: string,
  content: string,
): Promise<Sent & { runId: string }> {
  const s = await post(c, who, roomId, { content });
  expect(s.res.status).toBe(201);
  expect(s.runId ?? "").toMatch(UUID_RE);
  return s as Sent & { runId: string };
}
/** Runtime giả trả `done` cho job kế của run. */
export async function answer(c: CtxB, runId: string, text: string): Promise<Job> {
  const job = await c.rt.next(runId);
  await c.rt.agent(job, { status: "done", text });
  return job;
}

/** Timeline (`GET /rooms/:id/messages`) theo người xem. */
export async function timeline(c: CtxB, who: Who, roomId: string, q = ""): Promise<Json[]> {
  const r = await api(c.hub, await c.tok(who), "GET", `/rooms/${roomId}/messages${q}`);
  expect(r.status).toBe(200);
  return r.json.items as Json[];
}
export const agentMsgs = (items: Json[]) => items.filter((m) => m.sender_type === "agent");
/** Chờ tin agent của `runId` xuất hiện trong timeline người xem; không có trong `ms` ⇒ undefined. */
export async function waitAgentMsg(c: CtxB, who: Who, roomId: string, runId: string, ms = 8_000) {
  const items = await waitFor(
    () => timeline(c, who, roomId),
    (xs) => xs.some((m) => m.sender_type === "agent" && m.run_id === runId),
    ms,
  );
  return items.find((m) => m.sender_type === "agent" && m.run_id === runId);
}

// ---------- DB (owner, an toàn trước migration 0014) ----------
/** Run gắn phòng (`runs.room_id`). */
export const roomRuns = (sql: Sql, roomId: string) =>
  sql<Json[]>`select r.id, r.user_id, r.status, r.conversation_id from hub.runs r
    where to_jsonb(r)->>'room_id' = ${roomId} order by r.started_at`;
export const runCount = async (sql: Sql, roomId: string): Promise<number> =>
  (await roomRuns(sql, roomId)).length;
/** Tổng token usage của user trên các run gắn phòng. */
export async function roomUsage(sql: Sql, roomId: string, userId: string): Promise<number> {
  const [r] = await sql<
    { n: number }[]
  >`select coalesce(sum(u.input_tokens + u.output_tokens), 0)::int as n
    from hub.usage_logs u join hub.runs r on r.id = u.run_id
    where to_jsonb(r)->>'room_id' = ${roomId} and u.user_id = ${userId}`;
  return r?.n ?? 0;
}
export const roomMsgCount = async (sql: Sql, roomId: string): Promise<number> =>
  (
    await sql<
      { n: number }[]
    >`select count(*)::int as n from hub.room_messages where room_id = ${roomId}`
  )[0]?.n ?? 0;
/** Dọn run còn chạy giữa ca (giới hạn run = 2): kết thúc bằng SQL. */
export async function settle(sql: Sql): Promise<void> {
  const rows = await sql<{ id: string }[]>`select id from hub.runs where status = 'running'`;
  for (const r of rows) await endSqlRun(sql, r.id);
}
