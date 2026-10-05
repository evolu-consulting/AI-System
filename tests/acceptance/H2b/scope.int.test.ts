// HUB-FR-91 · HUB-BR-03 · AC-H19 · H2b-R09, R15 · plan §5.3, P13 · test-plan H2b §5, cases §2 A40–A44: nhiều tag → run
// `orchestrated`, `<agents>` của Orchestrator thu hẹp đúng các agent được tag (∈ AU, sắp key), `<message>` không có tag,
// step `orchestrator` ghi `detail.scope`; delegate ngoài danh sách → `skipped(not_allowed)`; tin kế không tag dùng danh
// sách đầy đủ; tag Orchestrator → 404. AU `lan` = assistant, helper, writer (fixture `_h2b.ts`).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { call, type Json, type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import {
  AG,
  block,
  type HubX,
  insertConv,
  runIdOf,
  runRow,
  type Sse,
  send,
  testRedis,
} from "../H1/_hub";
import { echoAnswer, type Job, ScriptRuntime } from "../H1/_runtime";
import {
  AG3,
  expectAgentNotFound,
  LAN_AU,
  messageOf,
  settleRuns,
  setupH2b,
  startHubH2b,
} from "./_h2b";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;

beforeAll(async () => {
  sql = await setupH2b();
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

type Run = { s: Sse; runId: string; conv: string; flowId: string };
async function start(content: string, conv?: string, flow?: string): Promise<Run> {
  const c = conv ?? (await insertConv(sql, "lan", crypto.randomUUID()));
  const s = await send(hub, await sign(k, USERS.lan), c, content, flow);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s), conv: c, flowId: s.headers.get("x-flow-id") ?? "" };
}
async function finish(x: Run): Promise<Json> {
  const end = await x.s.terminal(15_000);
  x.s.close();
  expect(end?.event).toBe("run.finished");
  return end?.data;
}
const agentKeys = (job: Job): string[] =>
  (JSON.parse(block(job.payload.prompt, "agents") ?? "null") ?? []).map((a: Json) => a.key);
async function orchJob(runId: string): Promise<Job> {
  const job = await rt.next(runId);
  expect(job.payload.agent.role).toBe("orchestrator");
  return job;
}

describe("A40–A44 · nhiều tag thu hẹp danh sách Orchestrator [AC-H19 · H2b-R09]", () => {
  it("HUB-FR-91 · A40 · '@helper @assistant so sánh' → orchestrated; <agents> = [assistant, helper]; <message> = 'so sánh'; step orchestrator detail.scope = [assistant, helper] [AC-H19 · H2b-R09 · P13]", async () => {
    const x = await start("@helper @assistant so sánh");
    const job = await orchJob(x.runId);
    expect(agentKeys(job)).toEqual(["assistant", "helper"]);
    expect(messageOf(job)).toBe("so sánh");
    await rt.decide(job, echoAnswer(job));
    await finish(x);
    expect((await runRow(sql, x.runId))?.kind).toBe("orchestrated");
    const steps = await sql`select detail from hub.run_steps where run_id = ${x.runId}
      and type = 'orchestrator'`;
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s.detail?.scope).toEqual(["assistant", "helper"]);
  });

  it("HUB-FR-91 · A41 · run 2 tag: Orchestrator giả delegate writer (ngoài danh sách) → step skipped not_allowed, 0 job writer; rồi delegate assistant → chạy [AC-H19 · H1-R06]", async () => {
    const x = await start("@helper @assistant làm giúp A41");
    await rt.decide(await orchJob(x.runId), {
      decision: "delegate",
      agent: "writer",
      task: "Viết",
    });
    await rt.decide(await orchJob(x.runId), {
      decision: "delegate",
      agent: "assistant",
      task: "Làm",
    });
    const ag = await rt.next(x.runId);
    expect(ag.payload.agent.key).toBe("assistant");
    await rt.agent(ag, { status: "done", text: "Trợ lý làm xong A41." });
    expect((await finish(x))?.content).toBe("Trợ lý làm xong A41.");
    const [w] = await sql<{ n: number }[]>`select count(*)::int as n from hub.jobs
      where run_id = ${x.runId} and agent_id = ${AG3.writer}`;
    expect(w?.n).toBe(0);
    const skipped = await sql`select detail from hub.run_steps where run_id = ${x.runId}
      and status = 'skipped'`;
    expect(skipped.map((s) => s.detail?.reason)).toEqual(["not_allowed"]);
  });

  it("HUB-FR-91 · A42 · sau run 2 tag, tin kế không tag cùng flow → <agents> đủ AU (3) [H2b-R09]", async () => {
    const x = await start("@helper @assistant câu đầu A42");
    const j1 = await orchJob(x.runId);
    expect(agentKeys(j1)).toEqual(["assistant", "helper"]);
    await rt.decide(j1, echoAnswer(j1));
    await finish(x);
    const y = await start("Câu tiếp A42", x.conv, x.flowId);
    const j2 = await orchJob(y.runId);
    expect(agentKeys(j2)).toEqual([...LAN_AU]);
    await rt.decide(j2, echoAnswer(j2));
    await finish(y);
  });

  it("HUB-BR-03 · A43 · '@assistant @orchestrator x' → 404 AGENT_NOT_FOUND (Orchestrator không tag được) [H2b-R15]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const res = await call(hub, "POST", `/conversations/${conv}/messages`, {
      token: await sign(k, USERS.lan),
      body: { content: "@assistant @orchestrator x" },
    });
    expectAgentNotFound(res);
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from hub.runs
      where conversation_id = ${conv}`;
    expect(r?.n).toBe(0);
  });

  it("HUB-FR-91 · A44 · '@helper @assistant @Helper x' → <agents> 2 agent (gộp tag trùng) [H2b-R04]", async () => {
    const x = await start("@helper @assistant @Helper x");
    const job = await orchJob(x.runId);
    expect(agentKeys(job)).toEqual(["assistant", "helper"]);
    expect(job.payload.agent.id).toBe(AG.orchestrator);
    await rt.decide(job, echoAnswer(job));
    await finish(x);
  });
});
