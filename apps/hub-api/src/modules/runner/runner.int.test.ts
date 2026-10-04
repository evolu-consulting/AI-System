// HUB-FR-89 · HUB-FR-24 · H1-R18 · P7, P8, P11 · JobAgentRunner trên hub-api thật + DB + Redis; test đóng vai Runtime
// (`tests/acceptance/H1/_runtime.ts`, chỉ đọc). Vòng chạy = driver tạm "delegate thẳng agent `assistant`" (thay B8).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ChatEventSchema } from "@ai/contracts/chat";
import { type AgentCliJob, JobEnqueuedPayloadSchema } from "@ai/contracts/hub";
import { withHubScope } from "@ai/db/hub-scope";
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
} from "../../../../../tests/acceptance/H1/_fixtures";
import {
  AG,
  idGen,
  insertConv,
  insertHubConfig,
  runIdOf,
  type Sse,
  send,
} from "../../../../../tests/acceptance/H1/_hub";
import { ScriptRuntime } from "../../../../../tests/acceptance/H1/_runtime";
import { createApp } from "../../app";
import { connectDb } from "../../lib/db";
import { logger } from "../../lib/logger";
import { createRedis, type Redis } from "../../lib/redis";
import { runErrorText } from "../runs/run-errors";
import type { RunContext, RunDriver } from "../runs/runs.service";
import { JobAgentRunner, runJob } from "./job-agent-runner";
import { RunStreamReader } from "./run-stream-reader";
import { enqueueJob } from "./runner.repo";

const OWNER = "b7-hub";
const MAX_WAIT_S = 2;
let sql: Sql;
let k: Keys;
let hub: Hub;
let redis: Redis;
let rt: ScriptRuntime;
const ac = new AbortController();
const id = idGen(7000);

/** Driver tạm: một job agent `assistant` (prompt = tin user) → kết thúc run theo kết quả job. */
function delegateDriver(runner: JobAgentRunner): RunDriver {
  const drive = async (ctx: RunContext) => {
    const w = ctx.writer;
    const agent = ctx.snapshot.agents.find((a) => a.key === "assistant");
    if (!agent) throw new Error("thiếu agent assistant");
    const task = {
      run: w.run,
      snapshot: ctx.snapshot,
      agent,
      role: "agent" as const,
      prompt: ctx.content,
      history: [],
      emit: (ev: Parameters<typeof w.emit>[0]) => w.emit(ev),
    };
    const out = await runJob(runner, task, w.signal, ctx.log);
    if (out.kind === "aborted") return;
    if (out.kind === "failed") return void (await w.finish({ kind: "failed", code: out.code }));
    const o = out.output;
    const text = o.kind === "text" ? o.text : "text" in o.result ? o.result.text : "";
    await w.finish({ kind: "finished", content: text, agentId: agent.id });
  };
  return {
    start: (ctx) => void drive(ctx).catch((e) => ctx.log.error("b7-driver", { e: String(e) })),
  };
}

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
  const db = connectDb(HUB_API_URL, 5);
  redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const reader = new RunStreamReader(redis, logger, ac.signal);
  const runner = new JobAgentRunner({
    db,
    owner: OWNER,
    reader,
    maxWaitS: MAX_WAIT_S,
    log: logger,
  });
  const app = createApp(
    { version: "0.0.0-test", corsOrigins: [] },
    {
      db,
      redis,
      jwtPublicKey: k.publicKey,
      appEnv: "test",
      instanceId: OWNER,
      runDriver: delegateDriver(runner),
      signal: ac.signal,
    },
  );
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  hub = {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
  rt = new ScriptRuntime(sql, redis, "b7-rt");
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

async function start(content: string): Promise<{ s: Sse; runId: string }> {
  const conv = await insertConv(sql, "lan", id());
  const s = await send(hub, await sign(k, USERS.lan), conv, content);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s) };
}
async function end(s: Sse, ms = 10_000) {
  const e = await s.terminal(ms);
  s.close();
  return e;
}
const setState = (status: string) =>
  sql`insert into hub.provider_state (provider_key, status) values ('fake-cli', ${status})
    on conflict (provider_key) do update set status = excluded.status, cooldown_until = null`;

describe("B7 · JobAgentRunner [HUB-FR-89 · HUB-FR-24]", () => {
  it("HUB-FR-89 · job + NOTIFY cùng transaction, payload agent, step_id = run_steps.id, step.* SSE, run.finished", async () => {
    const listener = ownerSql();
    const notes: unknown[] = [];
    const sub = await listener.listen("job_enqueued", (raw) => void notes.push(JSON.parse(raw)));
    try {
      const { s, runId } = await start("Việc B7");
      const job = await rt.next(runId);
      expect(job.payload).toMatchObject({
        agent: { id: AG.assistant, key: "assistant", role: "agent" },
        prompt: "Việc B7",
        max_turns: 30,
        use_session: true,
        output: "agent_result",
        provider_key: "fake-cli",
      });
      const note = notes.find((n) => (n as { job_id?: string }).job_id === job.id);
      expect(JobEnqueuedPayloadSchema.safeParse(note).success).toBe(true);
      await rt.progress(job);
      await rt.agent(job, { status: "done", text: "Xong B7." });
      const e = await end(s);
      expect(e?.event).toBe("run.finished");
      expect(e?.data?.content).toBe("Xong B7.");
      expect(s.events.map((x) => x.event)).toEqual([
        "run.started",
        "step.started",
        "step.finished",
        "run.finished",
      ]);
      for (const x of s.events) expect(ChatEventSchema.safeParse(x).success).toBe(true);
      expect(s.events[1]?.data).toEqual({ step_id: "s1", label: "Đang xử lý…" });
      const [st] = await sql`select id, seq, type, status, job_id, agent_id, provider_key
        from hub.run_steps where run_id = ${runId}`;
      expect(st).toMatchObject({
        id: job.payload.step_id,
        seq: 1,
        type: "delegate",
        status: "ok",
        job_id: job.id,
        agent_id: AG.assistant,
        provider_key: "fake-cli",
      });
    } finally {
      await sub.unlisten();
      await listener.end();
    }
  });
});

describe("B7 · không INSERT job cho run đã đóng / không còn của mình [H1-R14 · P12]", () => {
  it("H1-R14 · enqueueJob: owner khác → null; run đã kết thúc → null; không ghi jobs/run_steps", async () => {
    const { s, runId } = await start("Câu B7 đóng");
    const job = await rt.next(runId);
    const p = job.payload as AgentCliJob;
    const step = (owner: string) => ({
      stepId: p.step_id,
      type: "delegate" as const,
      labelKey: "step.delegate",
      reopen: true,
      owner,
    });
    const again = (owner: string) =>
      withHubScope(hub.db, { kind: "system" }, (tx) =>
        enqueueJob(tx, { ...p, job_id: crypto.randomUUID() }, step(owner)),
      );
    expect(await again("other-hub")).toBeNull();
    await rt.agent(job, { status: "done", text: "Xong." });
    expect((await end(s))?.event).toBe("run.finished");
    expect(await again(OWNER)).toBeNull();
    const [n] = await sql`select count(*)::int as n from hub.jobs where run_id = ${runId}`;
    expect(n?.n).toBe(1);
    const [st] = await sql`select status, job_id from hub.run_steps where run_id = ${runId}`;
    expect(st).toMatchObject({ status: "ok", job_id: job.id });
  });
});

describe("B7 · provider, hết hạn queued, dựng từ DB, lỗi job [H1-R18 · P7 · P8 · P11]", () => {
  it("H1-R18 · provider_state error → run.failed ALL_PROVIDERS_EXHAUSTED ngay, không job, không step", async () => {
    await setState("error");
    try {
      const t0 = Date.now();
      const { s, runId } = await start("Câu B7 provider");
      const e = await end(s, 5_000);
      expect(e?.data?.code).toBe("ALL_PROVIDERS_EXHAUSTED");
      expect(Date.now() - t0).toBeLessThan(3_000);
      const [n] =
        await sql`select (select count(*)::int from hub.jobs where run_id = ${runId}) as j,
        (select count(*)::int from hub.run_steps where run_id = ${runId}) as s`;
      expect(n).toEqual({ j: 0, s: 0 });
    } finally {
      await setState("ok");
    }
  });

  it("P8 · job queued quá max_wait_s → failed provider_busy + run.failed ALL_PROVIDERS_EXHAUSTED", async () => {
    const t0 = Date.now();
    const { s, runId } = await start("Câu B7 chờ");
    const e = await end(s, 8_000);
    expect(e?.data?.code).toBe("ALL_PROVIDERS_EXHAUSTED");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(MAX_WAIT_S * 1000);
    const jobs =
      await sql`select status, error_code, error_reason from hub.jobs where run_id = ${runId}`;
    expect(jobs.map((j) => ({ ...j }))).toEqual([
      { status: "failed", error_code: "ALL_PROVIDERS_EXHAUSTED", error_reason: "provider_busy" },
    ]);
    const [st] = await sql`select status, detail from hub.run_steps where run_id = ${runId}`;
    expect(st?.status).toBe("failed");
  });
});
describe("B7 · dựng từ DB, lỗi job [P7 · P11]", () => {
  it("P7 · Runtime ghi DB succeeded, không XADD → Hub dựng từ DB ≤ 5 s", async () => {
    const { s, runId } = await start("Câu B7 DB");
    const job = await rt.next(runId);
    await rt.result(
      job,
      { kind: "agent_result", result: { status: "done", text: "Từ DB." } },
      undefined,
      false,
    );
    const t0 = Date.now();
    const e = await end(s, 8_000);
    expect(e?.data?.content).toBe("Từ DB.");
    expect(Date.now() - t0).toBeLessThanOrEqual(5_000);
  });

  it("P11 · job.failed: client nhận câu tĩnh theo mã, message gốc chỉ ở run_steps.detail", async () => {
    const { s, runId } = await start("Câu B7 lỗi");
    const job = await rt.next(runId);
    const raw = "provider fake-cli lộ /home/rt/work/secret";
    await rt.fail(job, "UPSTREAM_ERROR", raw, "crash");
    const e = await end(s);
    expect(e?.event).toBe("run.failed");
    expect(e?.data).toMatchObject({
      code: "UPSTREAM_ERROR",
      ...runErrorText("UPSTREAM_ERROR", "vi"),
    });
    expect(JSON.stringify(s.events)).not.toContain("secret");
    const [st] = await sql`select status, detail from hub.run_steps where run_id = ${runId}`;
    expect(st?.status).toBe("failed");
    expect(st?.detail).toMatchObject({ code: "UPSTREAM_ERROR", reason: "crash", message: raw });
  });
});
