// HUB-FR-43 · H1-R14 · P12 · E15 + E9 huỷ run (plan H1 §5.7) trên hub-api thật + DB + Redis (hạ tầng QW-A1/A2
// `tests/acceptance/H1`, chỉ đọc). Vòng chạy run = driver điều khiển tay (thay B8); job chèn tay (đóng vai runner B7).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { JobCancelPayloadSchema } from "@ai/contracts/hub";
import {
  call,
  err,
  errorOf,
  HUB_API_URL,
  type Hub,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  R,
  REDIS_TEST_URL,
  type Sql,
  sign,
  USERS,
  type UserKey,
} from "../../../../../tests/acceptance/H1/_fixtures";
import {
  AG,
  idGen,
  insertConv,
  insertHubConfig,
  isTerminal,
  openSse,
  runIdOf,
  runRow,
  type Sse,
  send,
  sseStream,
} from "../../../../../tests/acceptance/H1/_hub";
import { createApp } from "../../app";
import { connectDb } from "../../lib/db";
import { createRedis } from "../../lib/redis";
import { runErrorText } from "./run-errors";
import type { RunContext, RunDriver } from "./runs.service";
import { RunFencedError } from "./sse-writer";

type Inst = Hub & { ctxs: Map<string, RunContext> };

let sql: Sql;
let k: Keys;
let a: Inst;
let b: Inst;
const id = idGen(9000);

async function startInst(owner: string): Promise<Inst> {
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
      instanceId: owner,
      runDriver: driver,
      signal: ac.signal,
    },
  );
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  return {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    ctxs,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
  a = await startInst("b9-hub-a");
  b = await startInst("b9-hub-b");
}, 60_000);
afterAll(async () => {
  await a?.stop();
  await b?.stop();
  await sql?.end();
});

const tok = (who: UserKey) => sign(k, USERS[who]);
async function started(who: UserKey = "lan", conv?: string) {
  const c = conv ?? (await insertConv(sql, who, id()));
  const s = await send(a, await tok(who), c, "Việc sẽ bị huỷ");
  expect(s.status).toBe(200);
  const ctx = a.ctxs.get(runIdOf(s));
  if (!ctx) throw new Error("driver chưa nhận run");
  return { s, ctx, conv: c, runId: runIdOf(s) };
}
const cancel = async (runId: string, h: Hub = a, who: UserKey = "lan") =>
  call(h, "POST", `/runs/${runId}/cancel`, { token: await tok(who) });

/** Job của run, đóng vai runner B7 (`status` queued/running). */
async function insertJob(runId: string, status: "queued" | "running"): Promise<string> {
  const jobId = id();
  const r = await runRow(sql, runId);
  await sql`insert into hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
      provider_key, payload, status, started_at)
    values (${jobId}, ${r.tenant_id}, ${r.user_id}, ${runId}, ${id()}, ${r.conversation_id}, ${AG.assistant},
      'agent.cli', 'fake-cli', ${sql.json({})}, ${status}, ${status === "running" ? new Date() : null})`;
  return jobId;
}

function expectCancelled(e: Json, who: UserKey): void {
  const t = runErrorText("CANCELLED", USERS[who].locale);
  expect(e?.event).toBe("run.failed");
  expect(e?.data).toMatchObject({ code: "CANCELLED", message: t.message, hint: "" });
}

describe("E15 · chủ là instance này [HUB-FR-43 · H1-R14]", () => {
  it("HUB-FR-43 · 200 ảnh chụp lúc nhận, writer dừng, run.failed CANCELLED, run + tin assistant (nối delta), lần 2 không phát", async () => {
    const { s, ctx, runId } = await started("hoa");
    await ctx.writer.emit({ event: "delta", data: { text: "Một " } });
    await ctx.writer.emit({ event: "delta", data: { text: "phần" } });
    const res = await cancel(runId, a, "hoa");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: runId, status: "running", last_event_id: 3, error: null });
    expectCancelled(await s.terminal(5_000), "hoa");
    s.close();
    expect(ctx.writer.signal.aborted).toBe(true);
    expect(await ctx.writer.finish({ kind: "finished", content: "muộn" })).toBe(false);
    const t = runErrorText("CANCELLED", "en");
    expect(await runRow(sql, runId)).toMatchObject({
      status: "cancelled",
      owner: "b9-hub-a",
      last_seq: 4,
      error_code: "CANCELLED",
      error_message: t.message,
      error_hint: "",
    });
    const msgs =
      await sql`select content from hub.messages where run_id = ${runId} and role = 'assistant'`;
    expect(msgs.map((m) => m.content)).toEqual(["Một phần"]);
    const len = (await sseStream(a.redis, runId)).length;
    const again = await cancel(runId, a, "hoa");
    expect(again.json).toMatchObject({ status: "cancelled", last_event_id: 4 });
    expect((await sseStream(a.redis, runId)).length).toBe(len);
  });
});

describe("E15 · huỷ job của run [HUB-FR-43 · H1-R14]", () => {
  it("H1-R14 · job queued → cancelled; job running → cancel_requested_at + NOTIFY job_cancel đúng contract", async () => {
    const notes: Json[] = [];
    const listener = ownerSql();
    const sub = await listener.listen("job_cancel", (raw) => notes.push(JSON.parse(raw)));
    try {
      const { s, runId } = await started("lan");
      const queued = await insertJob(runId, "queued");
      const running = await insertJob(runId, "running");
      expect((await cancel(runId)).status).toBe(200);
      expectCancelled(await s.terminal(5_000), "lan");
      s.close();
      const jobs = await sql`select id, status, cancel_requested_at is not null as c,
        finished_at is not null as f from hub.jobs where run_id = ${runId}`;
      const byId = (j: string) => jobs.find((x) => x.id === j);
      expect(byId(queued)).toMatchObject({ status: "cancelled", c: true, f: true });
      expect(byId(running)).toMatchObject({ status: "running", c: true, f: false });
      await Bun.sleep(300);
      const mine = notes.filter((n) => n.run_id === runId);
      expect(mine).toEqual([{ v: 1, job_id: running, run_id: runId }]);
      expect(JobCancelPayloadSchema.safeParse(mine[0]).success).toBe(true);
    } finally {
      await sub.unlisten();
      await listener.end();
    }
  });
});

describe("E15 · instance khác, run đã xong [HUB-FR-43 · UC-04]", () => {
  it("H1-R14 · chủ ở instance khác: E15 tới B → 1 sự kiện kết thúc, id liên tục; emit/finish của A bị chặn", async () => {
    const { s, ctx, runId } = await started("lan");
    await ctx.writer.emit({ event: "delta", data: { text: "A" } });
    const res = await cancel(runId, b);
    expect(res.status).toBe(200);
    expectCancelled(await s.terminal(5_000), "lan");
    s.close();
    const late = ctx.writer.emit({ event: "delta", data: { text: "muộn" } });
    await expect(late).rejects.toBeInstanceOf(RunFencedError);
    expect(await ctx.writer.finish({ kind: "finished", content: "muộn" })).toBe(false);
    const stream = await sseStream(a.redis, runId);
    expect(stream.map((x) => x.id)).toEqual(["1-0", "2-0", "3-0"]);
    const ends = stream.filter((x) => isTerminal({ id: 0, event: x.ev.event, data: null }));
    expect(ends.length).toBe(1);
    expect(await runRow(sql, runId)).toMatchObject({ status: "cancelled", owner: "b9-hub-b" });
  });

  it("UC-04 · run đã xong → 200 như E14, không đổi gì; run người khác / id lạ → 404", async () => {
    const before = await runRow(sql, R.runDone);
    const res = await cancel(R.runDone);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: R.runDone, status: "finished", error: null });
    expect(await runRow(sql, R.runDone)).toEqual(before);
    expect(errorOf(await cancel(R.runDone, a, "hoa"))).toEqual(err("NOT_FOUND"));
    expect(errorOf(await cancel(id()))).toEqual(err("NOT_FOUND"));
    expect(errorOf(await cancel("khong-phai-uuid"))).toEqual(err("NOT_FOUND"));
  });
});

describe("E9 · xoá hội thoại huỷ run [HUB-FR-43 · plan §5.7]", () => {
  it("HUB-FR-43 · 2 flow đang chạy → 204, cả 2 run cancelled + SSE CANCELLED; lần 2 → 404", async () => {
    const first = await started("lan");
    const conv = first.conv;
    const second = await openSse(a, "POST", `/conversations/${conv}/messages`, {
      token: await tok("lan"),
      body: { content: "Flow thứ hai" },
    });
    expect(second.status).toBe(200);
    const job = await insertJob(first.runId, "running");
    const del = await call(a, "DELETE", `/conversations/${conv}`, { token: await tok("lan") });
    expect(del.status).toBe(204);
    for (const s of [first.s, second] as Sse[]) {
      expectCancelled(await s.terminal(5_000), "lan");
      s.close();
    }
    for (const r of [first.runId, runIdOf(second)]) {
      expect((await runRow(sql, r))?.status).toBe("cancelled");
    }
    const [j] =
      await sql`select cancel_requested_at is not null as c from hub.jobs where id = ${job}`;
    expect(j?.c).toBe(true);
    const again = await call(a, "DELETE", `/conversations/${conv}`, { token: await tok("lan") });
    expect(errorOf(again)).toEqual(err("NOT_FOUND"));
    const ok = await cancel(first.runId);
    expect(ok.json?.status).toBe("cancelled");
  });
});
