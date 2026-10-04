// HUB-FR-89 · HUB-BR-03 · HUB-H1-AC-H13 · H1-R05, H1-R18 · test-plan H1 §5 A27–A32: AgentRunner — payload agent,
// tin bắt đầu `/`, INSERT job + NOTIFY cùng transaction, provider không dùng được, hết hạn `queued`, dựng kết quả từ DB.
// Hộp đen: HTTP hub-api thật + DB `ai_system_h1_test` + Redis DB 15; test đóng vai Runtime (`_runtime.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ALLOWED_TOOLS, JobEnqueuedPayloadSchema } from "@ai/contracts/hub";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  adminChange,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  T,
  USERS,
  type UserKey,
} from "./_fixtures";
import {
  AG,
  type HubX,
  idGen,
  insertConv,
  insertHubConfig,
  runIdOf,
  type Sse,
  send,
  startHubX,
  testRedis,
} from "./_hub";
import { ScriptRuntime } from "./_runtime";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
const id = idGen(3000);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  await sql`update hub.agents set runtime_options = ${sql.json({ allowed_tools: ["Glob"], max_turns: 7 })},
    timeout_s = 120 where id = ${AG.helper}`;
  k = await makeKeys();
  hub = await startHubX(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

const tok = (who: UserKey) => sign(k, USERS[who]);
async function start(
  content: string,
  h: HubX = hub,
  who: UserKey = "lan",
): Promise<{ s: Sse; runId: string }> {
  const conv = await insertConv(sql, who, id());
  const s = await send(h, await tok(who), conv, content);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s) };
}
async function end(s: Sse, ms = 10_000): Promise<Json> {
  const e = await s.terminal(ms);
  s.close();
  return e;
}

/** Job `running` giả của `who` (chiếm slot tenant/provider) — run riêng, lease 1 giờ, heartbeat mới. */
async function insertRunningJob(who: UserKey, provider: string): Promise<string> {
  const x = USERS[who];
  const conv = await insertConv(sql, who, id());
  const [flow, run, job] = [id(), id(), id()];
  await sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
    values (${flow}, ${x.tid}, ${x.id}, ${conv}, 'Chiếm slot', 2)`;
  await sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, owner, lease_until)
    values (${run}, ${x.tid}, ${x.id}, ${conv}, ${flow}, 'running', 1, ${id()}, ${id()},
            'qc-other-instance', now() + interval '1 hour')`;
  await sql`insert into hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
      provider_key, payload, status, worker_id, started_at, heartbeat_at)
    values (${job}, ${x.tid}, ${x.id}, ${run}, ${id()}, ${conv}, ${AG.assistant}, 'agent.cli', ${provider},
            ${sql.json({})}, 'running', 'qc-slot-worker', now(), now())`;
  return run;
}
async function releaseRuns(runs: string[]): Promise<void> {
  await sql`update hub.jobs set status = 'succeeded', finished_at = now() where run_id = any(${sql.array(runs, 2950)})`;
  await sql`update hub.runs set status = 'finished', finished_at = now() where id = any(${sql.array(runs, 2950)})`;
}

describe("A27–A29 · payload agent, lệnh `/`, job + NOTIFY [HUB-BR-03 · H1-R05 · HUB-FR-89]", () => {
  it("A27 · payload agent: allowed_tools ⊂ {Read,Grep,Glob} (mặc định Read, Grep), max_turns 30, use_session=true, output agent_result; runtime_options được áp [HUB-BR-03 · H1-R21]", async () => {
    for (const [agent, tools, turns, timeout] of [
      ["assistant", ["Read", "Grep"], 30, 600],
      ["helper", ["Glob"], 7, 120],
    ] as const) {
      const { s, runId } = await start(`Nhờ ${agent} A27`);
      await rt.decide(await rt.next(runId), {
        decision: "delegate",
        agent,
        task: `Việc A27 ${agent}`,
      });
      const job = await rt.next(runId);
      const p = job.payload;
      for (const t of p.allowed_tools) expect(ALLOWED_TOOLS as readonly string[]).toContain(t);
      expect(p).toMatchObject({
        agent: { key: agent, role: "agent" },
        allowed_tools: [...tools],
        max_turns: turns,
        timeout_s: timeout,
        use_session: true,
        output: "agent_result",
        prompt: `Việc A27 ${agent}`,
      });
      await rt.agent(job, { status: "done", text: "Xong A27." });
      expect((await end(s))?.event).toBe("run.finished");
    }
  });

  it("A28 · tin bắt đầu `/` vẫn đi qua Orchestrator (có job Orchestrator, prompt chứa tin) [H1-R05]", async () => {
    const { s, runId } = await start("/tong-hop hoá đơn tháng 9");
    const job = await rt.next(runId);
    expect(job.payload.agent.role).toBe("orchestrator");
    expect(job.payload.prompt).toContain("/tong-hop hoá đơn tháng 9");
    await rt.decide(job, { decision: "answer", text: "Đã tổng hợp." });
    expect((await end(s))?.event).toBe("run.finished");
  });

  it("A29 · INSERT hub.jobs và NOTIFY job_enqueued cùng transaction: nhận NOTIFY ⇒ thấy dòng job ngay [HUB-FR-89]", async () => {
    const listener = ownerSql();
    const seen: { payload: Json; rowFound: boolean }[] = [];
    const sub = await listener.listen("job_enqueued", (raw) => {
      void (async () => {
        let payload: Json;
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = raw;
        }
        const jid =
          typeof payload?.job_id === "string"
            ? payload.job_id
            : "00000000-0000-0000-0000-000000000000";
        const rows = await listener`select id from hub.jobs where id = ${jid}`;
        seen.push({ payload, rowFound: rows.length === 1 });
      })();
    });
    try {
      const { s, runId } = await start("Câu A29");
      const job = await rt.next(runId);
      const deadline = Date.now() + 3_000;
      while (!seen.some((x) => x.payload?.job_id === job.id) && Date.now() < deadline)
        await Bun.sleep(25);
      const mine = seen.find((x) => x.payload?.job_id === job.id);
      expect(mine).toBeDefined();
      expect(JobEnqueuedPayloadSchema.safeParse(mine?.payload).success).toBe(true);
      expect(mine?.payload?.provider_key).toBe("fake-cli");
      expect(mine?.rowFound).toBe(true);
      await rt.decide(job, { decision: "answer", text: "Xong A29." });
      await end(s);
    } finally {
      await sub.unlisten();
      await listener.end();
    }
  });
});

describe("A30–A32 · provider, hết hạn queued, dựng từ DB [H1-R18 · HUB-H1-AC-H13 · P7]", () => {
  const setState = (status: string, cooldown: string | null) =>
    sql`insert into hub.provider_state (provider_key, status, cooldown_until)
      values ('fake-cli', ${status}, ${cooldown}::timestamptz)
      on conflict (provider_key) do update set status = excluded.status, cooldown_until = excluded.cooldown_until`;

  for (const [status, cooldown] of [
    ["cooldown", "2099-01-01T00:00:00Z"],
    ["logged_out", null],
    ["error", null],
  ] as const) {
    it(`A30 · provider_state ${status} → run.failed ALL_PROVIDERS_EXHAUSTED ngay, không tạo job [H1-R18 · HUB-FR-89]`, async () => {
      await setState(status, cooldown);
      try {
        const t0 = Date.now();
        const { s, runId } = await start(`Câu A30 ${status}`);
        const e = await end(s, 5_000);
        expect(e?.event).toBe("run.failed");
        expect(e?.data?.code).toBe("ALL_PROVIDERS_EXHAUSTED");
        expect(Date.now() - t0).toBeLessThan(3_000);
        const [j] = await sql<
          { n: number }[]
        >`select count(*)::int as n from hub.jobs where run_id = ${runId}`;
        expect(j?.n).toBe(0);
      } finally {
        await setState("ok", null);
      }
    });
  }

  it("A30 · cooldown đã qua → tạo job bình thường [H1-R18]", async () => {
    await setState("cooldown", "2000-01-01T00:00:00Z");
    try {
      const { s, runId } = await start("Câu A30 hết cooldown");
      const job = await rt.next(runId);
      await rt.decide(job, { decision: "answer", text: "Chạy được." });
      expect((await end(s))?.event).toBe("run.finished");
    } finally {
      await setState("ok", null);
    }
  });

  it("A31 · HUB_JOB_MAX_WAIT_S=2: acme limit 1 đang chạy 1 → job failed tenant_slots + run.failed ALL_PROVIDERS_EXHAUSTED trong [2, 6] s; provider đầy → provider_busy [HUB-H1-AC-H13]", async () => {
    const h2 = await startHubX(k, { instanceId: "qc-hub-wait", jobMaxWaitS: 2 });
    const held: string[] = [];
    try {
      await adminChange(
        sql,
        "tenant",
        T.acme,
        (tx) => tx`update admin.tenants set max_concurrent_sub = 1 where id = ${T.acme}`,
      );
      held.push(await insertRunningJob("tam", "claude-sub"));
      const expectQueueTimeout = async (reason: string) => {
        const t0 = Date.now();
        const { s, runId } = await start(`Câu A31 ${reason}`, h2);
        const e = await end(s, 8_000);
        const ms = Date.now() - t0;
        expect(e?.event).toBe("run.failed");
        expect(e?.data?.code).toBe("ALL_PROVIDERS_EXHAUSTED");
        expect(ms).toBeGreaterThanOrEqual(2_000);
        expect(ms).toBeLessThanOrEqual(6_000);
        const jobs =
          await sql`select status, error_code, error_reason from hub.jobs where run_id = ${runId}`;
        expect(jobs.map((j) => ({ ...j }))).toEqual([
          { status: "failed", error_code: "ALL_PROVIDERS_EXHAUSTED", error_reason: reason },
        ]);
      };
      await expectQueueTimeout("tenant_slots");

      await adminChange(
        sql,
        "tenant",
        T.acme,
        (tx) => tx`update admin.tenants set max_concurrent_sub = null where id = ${T.acme}`,
      );
      held.push(await insertRunningJob("an", "fake-cli"), await insertRunningJob("an", "fake-cli"));
      await expectQueueTimeout("provider_busy");
    } finally {
      await releaseRuns(held);
      await adminChange(
        sql,
        "tenant",
        T.acme,
        (tx) => tx`update admin.tenants set max_concurrent_sub = null where id = ${T.acme}`,
      );
      await h2.stop();
    }
  });

  it("A32 · Runtime ghi DB succeeded + result nhưng không XADD → Hub dựng kết quả từ DB ≤ 5 s [P7 · HUB-FR-89]", async () => {
    const { s, runId } = await start("Câu A32");
    const job = await rt.next(runId);
    const text = "Kết quả chỉ có trong DB của ca A32.";
    await rt.result(
      job,
      { kind: "text", text: JSON.stringify({ decision: "answer", text }) },
      undefined,
      false,
    );
    const t0 = Date.now();
    const e = await end(s, 8_000);
    expect(e?.event).toBe("run.finished");
    expect(e?.data?.content).toBe(text);
    expect(Date.now() - t0).toBeLessThanOrEqual(5_000);
  });
});
