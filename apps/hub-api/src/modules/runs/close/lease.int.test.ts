// HUB-NFR-02 · H1-R13 · H1-R20 · P12 · lease 10 s, sweeper lease (plan H1 §5.2, §5.8), quét orphan phía Hub (plan-db §5.5)
// trên hub-api thật + DB + Redis (hạ tầng `tests/acceptance/H1`, chỉ đọc). Gọi thẳng một lượt (`renewLeases`,
// `sweepExpiredLeases`, `sweepOrphans`) thay vì chờ nhịp 10 s; vòng chạy run = driver điều khiển tay.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { RunEventSchema } from "@ai/contracts/hub";
import {
  HUB_API_URL,
  type Hub,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  REDIS_TEST_URL,
  type Sql,
  sign,
  USERS,
  type UserKey,
} from "../../../../../../tests/acceptance/H1/_fixtures";
import {
  AG,
  idGen,
  insertConv,
  insertHubConfig,
  isTerminal,
  runIdOf,
  runRow,
  send,
  sseStream,
} from "../../../../../../tests/acceptance/H1/_hub";
import { createApp } from "../../../app";
import { connectDb } from "../../../lib/db";
import { logger } from "../../../lib/logger";
import { createRedis } from "../../../lib/redis";
import { sweepOrphans } from "../../runner/orphan-sweep";
import { runErrorText } from "../run-errors";
import type { RunContext, RunDriver } from "../runs.service";
import { RunRegistry } from "../sse/sse-writer";
import { renewLeases } from "./lease";
import { sweepExpiredLeases } from "./sweeper";

const OWNER = "b10-hub-a";
let sql: Sql;
let k: Keys;
let a: Hub & { ctxs: Map<string, RunContext> };
const id = idGen(9500);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
  const ctxs = new Map<string, RunContext>();
  const driver: RunDriver = { start: (ctx) => void ctxs.set(ctx.writer.run.id, ctx) };
  const db = connectDb(HUB_API_URL, 5);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const app = createApp(
    { version: "0.0.0-test", corsOrigins: [] },
    {
      db,
      redis,
      jwtPublicKey: k.publicKey,
      appEnv: "test",
      instanceId: OWNER,
      runDriver: driver,
      signal: ac.signal,
    },
  );
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  const stop = async () => {
    ac.abort();
    await server.stop(true);
    redis.disconnect();
    await db.close();
  };
  a = { base: `http://localhost:${server.port}`, db, redis, ctxs, stop };
}, 60_000);
afterAll(async () => {
  await a?.stop();
  await sql?.end();
});

async function started(who: UserKey = "lan") {
  const s = await send(a, await sign(k, USERS[who]), await insertConv(sql, who, id()), "Việc B10");
  expect(s.status).toBe(200);
  const runId = runIdOf(s);
  const ctx = a.ctxs.get(runId);
  if (!ctx) throw new Error("driver chưa nhận run");
  const registry = new RunRegistry();
  registry.add(ctx.writer);
  return { s, ctx, runId, registry };
}

async function insertRunningJob(runId: string, heartbeatAgoS: number): Promise<string> {
  const jobId = id();
  const r = await runRow(sql, runId);
  await sql`insert into hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
      provider_key, payload, status, started_at, heartbeat_at, worker_id)
    values (${jobId}, ${r.tenant_id}, ${r.user_id}, ${runId}, ${id()}, ${r.conversation_id}, ${AG.assistant},
      'agent.cli', 'fake-cli', ${sql.json({})}, 'running', now(),
      now() - make_interval(secs => ${heartbeatAgoS}), 'b10-worker')`;
  return jobId;
}

const leaseLeftS = async (runId: string): Promise<number> => {
  const [r] = await sql<{ s: number }[]>`select extract(epoch from lease_until - now())::float as s
    from hub.runs where id = ${runId}`;
  return r?.s ?? 0;
};

describe("Lease 10 s [HUB-NFR-02 · H1-R13 · plan §5.2]", () => {
  it("H1-R13 · run của mình → lease = now()+30s; run mất (owner khác / đã kết thúc) → writer abort, không ghi gì", async () => {
    const { s, ctx, runId, registry } = await started();
    await sql`update hub.runs set lease_until = now() + interval '1 second' where id = ${runId}`;
    expect(await renewLeases({ db: a.db, owner: OWNER, registry })).toEqual([]);
    expect(await leaseLeftS(runId)).toBeGreaterThan(25);
    expect(ctx.writer.signal.aborted).toBe(false);

    await sql`update hub.runs set owner = 'b10-other' where id = ${runId}`;
    const before = await sseStream(a.redis, runId);
    expect(await renewLeases({ db: a.db, owner: OWNER, registry })).toEqual([runId]);
    expect(ctx.writer.signal.aborted).toBe(true);
    expect(registry.ids()).toEqual([]);
    expect(await ctx.writer.finish({ kind: "finished", content: "muộn" })).toBe(false);
    expect((await runRow(sql, runId))?.status).toBe("running");
    expect(await sseStream(a.redis, runId)).toEqual(before);
    s.close();
    await sql`update hub.runs set lease_until = now() + interval '1 hour' where id = ${runId}`;
  });

  it("HUB-NFR-02 · registry rỗng → không truy vấn, trả []", async () => {
    expect(await renewLeases({ db: a.db, owner: OWNER, registry: new RunRegistry() })).toEqual([]);
  });
});

describe("Sweeper lease [HUB-NFR-02 · H1-R13 · plan §5.8]", () => {
  it("H1-R13 · lease quá hạn → instance khác chiếm, failed INTERNAL_ERROR câu theo runs.locale (en), huỷ job, 1 sự kiện kết thúc", async () => {
    const { s, ctx, runId } = await started("hoa");
    await ctx.writer.emit({ event: "delta", data: { text: "Dở " } });
    const job = await insertRunningJob(runId, 0);
    await sql`update hub.runs set lease_until = now() - interval '1 second' where id = ${runId}`;
    const d = {
      db: a.db,
      redis: a.redis,
      owner: "b10-hub-b",
      registry: new RunRegistry(),
      log: logger,
    };
    expect(await sweepExpiredLeases(d)).toBeGreaterThanOrEqual(1);
    const t = runErrorText("INTERNAL_ERROR", "en");
    const end = await s.terminal(5_000);
    s.close();
    expect(end?.event).toBe("run.failed");
    expect(end?.data).toMatchObject({ code: "INTERNAL_ERROR", message: t.message, hint: t.hint });
    expect(await runRow(sql, runId)).toMatchObject({
      status: "failed",
      owner: "b10-hub-b",
      error_code: "INTERNAL_ERROR",
      error_message: t.message,
      error_hint: t.hint,
      last_seq: 3,
    });
    const [m] =
      await sql`select content from hub.messages where run_id = ${runId} and role = 'assistant'`;
    expect(m?.content).toBe("Dở ");
    const [j] =
      await sql`select cancel_requested_at is not null as c from hub.jobs where id = ${job}`;
    expect(j?.c).toBe(true);
    expect(await ctx.writer.finish({ kind: "finished", content: "muộn" })).toBe(false);
    const stream = await sseStream(a.redis, runId);
    expect(stream.map((x) => x.id)).toEqual(["1-0", "2-0", "3-0"]);
    expect(stream.filter((x) => isTerminal({ id: 0, event: x.ev.event, data: null })).length).toBe(
      1,
    );
    expect(await sweepExpiredLeases(d)).toBe(0);
  });
});

describe("Sweeper lease bỏ qua [P12 · plan §5.8]", () => {
  it("P12 · lease còn hạn (chủ vừa gia hạn) → sweeper bỏ qua", async () => {
    const { s, runId } = await started();
    const d = {
      db: a.db,
      redis: a.redis,
      owner: "b10-hub-b",
      registry: new RunRegistry(),
      log: logger,
    };
    await sweepExpiredLeases(d);
    expect(await runRow(sql, runId)).toMatchObject({ status: "running", owner: OWNER });
    s.close();
    await sql`update hub.runs set lease_until = now() + interval '1 hour' where id = ${runId}`;
  });
});

describe("Quét orphan phía Hub [H1-R20 · plan-db §5.5]", () => {
  it("H1-R20 · heartbeat > 60 s → failed orphaned + job.failed vào run:<id> đúng contract; heartbeat mới → không đụng", async () => {
    const { s, runId } = await started();
    const old = await insertRunningJob(runId, 61);
    const fresh = await insertRunningJob(runId, 5);
    const swept = await sweepOrphans({ db: a.db, redis: a.redis, log: logger });
    // Vòng nền của chính instance có thể nhận dòng trước lượt gọi tay: kiểm kết quả ở DB + stream.
    expect(swept.map((x) => x.id)).not.toContain(fresh);
    const jobs = await sql`select id, status, error_code, error_reason, finished_at is not null as f
      from hub.jobs where run_id = ${runId} order by id`;
    const byId = (j: string) => jobs.find((x) => x.id === j);
    expect(byId(old)).toMatchObject({
      status: "failed",
      error_code: "INTERNAL_ERROR",
      error_reason: "orphaned",
      f: true,
    });
    expect(byId(fresh)).toMatchObject({ status: "running", f: false });
    const rows = await a.redis.xrange(`run:${runId}`, "-", "+");
    const evs = rows.map(([, f]) => RunEventSchema.parse(JSON.parse(f[f.indexOf("e") + 1] ?? "")));
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      type: "job.failed",
      job_id: old,
      code: "INTERNAL_ERROR",
      reason: "orphaned",
    });
    expect(
      (await sweepOrphans({ db: a.db, redis: a.redis, log: logger })).map((x) => x.id),
    ).not.toContain(old);
    s.close();
    await sql`update hub.jobs set status = 'failed', finished_at = now() where id = ${fresh}`;
  });
});
