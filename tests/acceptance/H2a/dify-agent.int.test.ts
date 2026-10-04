// HUB-FR-23 · HUB-H2a-AC-07 · HUB-FR-24 (phần `mcp`) · H2a-R14, R15 · test-plan H2a cases §6 A40–A46: Orchestrator
// delegate tới agent `dify-workflow`/`dify-agent` → Hub gọi Dify trực tiếp (không hàng `jobs`), pass-through `done`,
// phiên `cli_sessions(provider_key='dify')`, lỗi/timeout/huỷ + stop, usage `agent_id`; payload `agent.cli.mcp` cho agent
// gắn workflow (url `<HUB_PUBLIC_INTERNAL_URL>/mcp`, không token), workflow tắt bị bỏ khỏi `tools`.
// Lệch plan (ghi §10): CHECK `agents_timeout_s_check` (10–3600) ⇒ không đặt được `timeout_s=1`; dùng 10 s + `mk-slow-3000`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AgentCliJobSchema } from "@ai/contracts/hub";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  USERS,
  waitFor,
} from "../H1/_fixtures";
import {
  AG,
  type HubX,
  hubConfigChange,
  insertConv,
  insertHubConfig,
  runIdOf,
  type Sse,
  send,
  testRedis,
} from "../H1/_hub";
import { echoAnswer, type Job, ScriptRuntime } from "../H1/_runtime";
import {
  AG2,
  catalogChange,
  type Dify,
  idGen2,
  insertCatalog,
  insertH2aAgents,
  setAppKey,
  startDify,
  startHubH2a,
  WF,
  WF_KEY,
} from "./_h2a";
import { MOCK_TEXT } from "./_h2a2";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
let dify: Dify;
const id = idGen2(6000);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  await insertH2aAgents(sql);
  k = await makeKeys();
  hub = await startHubH2a(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

type Turn = { s: Sse; runId: string; jobs: Job[] };
/**
 * Gửi `content` (hội thoại `conv` hoặc mới), Orchestrator lượt 1 delegate `agent` với `task`; job agent.cli khác
 * (agent thường) → `onAgent`; lượt Orchestrator sau → echo. Chờ tới sự kiện kết thúc.
 */
async function delegateTo(
  agent: string,
  task: string,
  o: { conv?: string; onAgent?: (job: Job) => Promise<void>; ms?: number } = {},
): Promise<Turn> {
  const conv = o.conv ?? (await insertConv(sql, "lan", id()));
  const s = await send(hub, await sign(k, USERS.lan), conv, `Nhờ ${agent}: ${task}`);
  const runId = runIdOf(s);
  const jobs: Job[] = [];
  try {
    expect(s.status).toBe(200);
    let turn = 0;
    await rt.serve(
      runId,
      async (job) => {
        jobs.push(job);
        if (job.payload.agent.role !== "orchestrator") {
          if (o.onAgent) await o.onAgent(job);
          else await rt.agent(job, { status: "done", text: "agent xong" });
          return;
        }
        turn++;
        if (turn === 1) await rt.decide(job, { decision: "delegate", agent, task });
        else await rt.decide(job, echoAnswer(job));
      },
      o.ms ?? 15_000,
    );
    await s.terminal(3_000);
  } finally {
    s.close();
  }
  return { s, runId, jobs };
}
const end = (t: Turn) =>
  t.s.events.find((e) => e.event === "run.finished" || e.event === "run.failed");

describe("A40–A44 · agent dify-* do Hub gọi Dify trực tiếp [HUB-FR-23 · HUB-H2a-AC-07 · H2a-R14]", () => {
  it("HUB-FR-23 · A40 · delegate dify-tom → không hàng jobs cho bước đó; MK nhận /v1/workflows/run user acme:<lan>; run.finished = text Dify (pass-through done) [HUB-FR-23 · HUB-H2a-AC-07]", async () => {
    dify.mock.reset();
    const t = await delegateTo("dify-tom", "xin chào");
    expect(end(t)?.event).toBe("run.finished");
    expect(end(t)?.data?.content).toBe(MOCK_TEXT);
    const runs = dify.runs();
    expect(runs.length).toBe(1);
    expect(runs[0]?.path).toBe("/v1/workflows/run");
    expect(runs[0]?.auth).toBe("Bearer mk-ok");
    expect(runs[0]?.body).toMatchObject({
      user: `acme:${USERS.lan.id}`,
      response_mode: "streaming",
      inputs: { source_text: "xin chào" },
    });
    const jobs = await sql<Json[]>`select agent_id, type from hub.jobs where run_id = ${t.runId}`;
    expect(jobs.some((j) => j.agent_id === AG2.difyTom)).toBe(false);
    expect(jobs.every((j) => j.agent_id === AG.orchestrator)).toBe(true);
    const steps = await sql<Json[]>`select type, agent_id, job_id, status from hub.run_steps
      where run_id = ${t.runId} and agent_id = ${AG2.difyTom}`;
    expect(steps.length).toBe(1);
    expect(steps[0]).toMatchObject({ type: "delegate", status: "ok" });
  });

  it("HUB-FR-23 · A41 · dify-tro-ly (dify-agent) lượt 1 → cli_sessions(provider dify); lượt 2 cùng hội thoại → conversation_id; hội thoại khác → không gửi [HUB-H2a-AC-07 · H2a-R14]", async () => {
    dify.mock.reset();
    const conv = await insertConv(sql, "lan", id());
    const t1 = await delegateTo("dify-tro-ly", "câu hỏi một", { conv });
    expect(end(t1)?.event).toBe("run.finished");
    const c1 = dify.runs()[0];
    expect(c1?.path).toBe("/v1/chat-messages");
    expect(c1?.body).toMatchObject({ query: "câu hỏi một", user: `acme:${USERS.lan.id}` });
    expect([undefined, null, ""]).toContain((c1?.body as Json)?.conversation_id);
    const [sess] = await sql<Json[]>`select session_id, tenant_id from hub.cli_sessions
      where conversation_id = ${conv} and agent_id = ${AG2.difyTroLy} and provider_key = 'dify'`;
    expect(sess?.session_id).toMatch(/^conv-\d+$/);
    expect(sess?.tenant_id).toBe(USERS.lan.tid);
    const t2 = await delegateTo("dify-tro-ly", "câu hỏi hai", { conv });
    expect(end(t2)?.event).toBe("run.finished");
    expect(dify.runs()[1]?.body).toMatchObject({ conversation_id: sess?.session_id });
    await delegateTo("dify-tro-ly", "câu hỏi ba");
    expect([undefined, null, ""]).toContain((dify.runs()[2]?.body as Json)?.conversation_id);
  });

  it("HUB-FR-23 · A42 · workflow của agent tắt → bước lỗi NOT_CONFIGURED (MK 0 lời gọi) → run.failed như H1; mk-failed → UPSTREAM_ERROR [H2a-R14]", async () => {
    dify.mock.reset();
    await catalogChange(
      sql,
      (tx) => tx`update admin.workflows set enabled = false where id = ${WF.tom}`,
    );
    try {
      await Bun.sleep(500);
      const t = await delegateTo("dify-tom", "xin chào");
      expect(end(t)?.event).toBe("run.failed");
      expect(end(t)?.data?.code).toBe("NOT_CONFIGURED");
      expect(dify.runs().length).toBe(0);
      const [st] = await sql<Json[]>`select status from hub.run_steps
        where run_id = ${t.runId} and agent_id = ${AG2.difyTom}`;
      expect(st?.status).toBe("failed");
    } finally {
      await catalogChange(
        sql,
        (tx) => tx`update admin.workflows set enabled = true where id = ${WF.tom}`,
      );
    }
    await Bun.sleep(500);
    await setAppKey(sql, "tom", "mk-failed");
    try {
      const t = await delegateTo("dify-tom", "xin chào");
      expect(end(t)?.data?.code).toBe("UPSTREAM_ERROR");
      expect(dify.runs().length).toBe(1);
    } finally {
      await setAppKey(sql, "tom", "mk-ok");
    }
  });

  it("HUB-FR-23 · A43 · agents.timeout_s=10 + mk-slow-3000 → bước TIMEOUT + MK nhận stop; huỷ run (E15) giữa chừng → MK nhận stop [H2a-R14 · H2a-R10]", async () => {
    await hubConfigChange(
      sql,
      (tx) => tx`update hub.agents set timeout_s = 10 where id = ${AG2.difyTom}`,
    );
    await setAppKey(sql, "tom", "mk-slow-3000");
    try {
      dify.mock.reset();
      const t0 = Date.now();
      const t = await delegateTo("dify-tom", "xin chào", { ms: 25_000 });
      expect(end(t)?.event).toBe("run.failed");
      expect(end(t)?.data?.code).toBe("TIMEOUT");
      expect(Date.now() - t0).toBeLessThanOrEqual(10_000 + 5_000);
      const stops = await waitFor(
        async () => dify.stops(),
        (v) => v.length > 0,
        3_000,
      );
      expect(stops[0]?.path).toMatch(/^\/v1\/workflows\/tasks\/task-\d+\/stop$/);
      // huỷ run giữa lúc Dify đang stream
      dify.mock.reset();
      const conv = await insertConv(sql, "lan", id());
      const tok = await sign(k, USERS.lan);
      const s = await send(hub, tok, conv, "Nhờ dify-tom lần nữa");
      try {
        const runId = runIdOf(s);
        const job = await rt.next(runId);
        await rt.decide(job, { decision: "delegate", agent: "dify-tom", task: "xin chào" });
        await waitFor(
          async () => dify.runs(),
          (v) => v.length > 0,
          5_000,
        );
        expect((await call(hub, "POST", `/runs/${runId}/cancel`, { token: tok })).status).toBe(200);
        const fin = await s.terminal(5_000);
        expect(fin?.data?.code).toBe("CANCELLED");
        const st = await waitFor(
          async () => dify.stops(),
          (v) => v.length > 0,
          3_000,
        );
        expect(st.length).toBeGreaterThan(0);
      } finally {
        s.close();
      }
    } finally {
      await setAppKey(sql, "tom", "mk-ok");
      await hubConfigChange(
        sql,
        (tx) => tx`update hub.agents set timeout_s = 60 where id = ${AG2.difyTom}`,
      );
    }
  }, 45_000);

  it("HUB-FR-23 · A44 · usage của bước dify-*: 1 dòng billing dify, agent_id = dify-tom, feature_id NULL, model NULL [H2a-R15]", async () => {
    const t = await delegateTo("dify-tom", "xin chào usage");
    expect(end(t)?.event).toBe("run.finished");
    const rows = await sql<
      Json[]
    >`select billing, provider_key, model, agent_id, feature_id, input_tokens
      from hub.usage_logs where run_id = ${t.runId} and billing = 'dify'`;
    expect([...rows]).toEqual([
      {
        billing: "dify",
        provider_key: "dify",
        model: null,
        agent_id: AG2.difyTom,
        feature_id: null,
        input_tokens: 20,
      },
    ]);
  });
});

describe("A45–A46 · payload agent.cli.mcp [HUB-FR-24 · HUB-FR-50]", () => {
  /** Payload job agent của `agent` (đã parse `AgentCliJob`) + payload Orchestrator lượt 1. */
  async function payloads(agent: string): Promise<{ orch: Json; agent: Json }> {
    const t = await delegateTo(agent, "việc cần làm");
    const orch = t.jobs.find((j) => j.payload.agent.role === "orchestrator");
    const ag = t.jobs.find((j) => j.payload.agent.key === agent);
    expect(ag).toBeDefined();
    expect(AgentCliJobSchema.safeParse(ag?.payload).success).toBe(true);
    return { orch: orch?.payload, agent: ag?.payload };
  }

  it("HUB-FR-24 · A45 · delegate trello → mcp = {url:<HUB_PUBLIC_INTERNAL_URL>/mcp, tools:[create-trello-card]}, không token; agent không gắn workflow + Orchestrator → mcp null [HUB-FR-24]", async () => {
    const p = await payloads("trello");
    expect(p.agent?.mcp).toEqual({ url: `${hub.base}/mcp`, tools: [WF_KEY.trello] });
    expect(JSON.stringify(p.agent)).not.toMatch(/"token"|job_token|authorization/i);
    expect(p.orch?.mcp).toBeNull();
    const q = await payloads("assistant");
    expect(q.agent?.mcp).toBeNull();
  });

  it("HUB-FR-24 · A46 · hoadon gắn check-invoice + tat (tắt) → tools chỉ [check-invoice] [HUB-FR-24 · HUB-BR-19]", async () => {
    const p = await payloads("hoadon");
    expect(p.agent?.mcp).toEqual({ url: `${hub.base}/mcp`, tools: [WF_KEY.checkInvoice] });
  });
});
