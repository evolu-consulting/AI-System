// HUB-FR-77 · HUB-BR-03 · chat-fast2 (`fastRoute` bật): tenant có agent mặc định `assistant` — người gửi được dùng (AU ≥ 2) ⇒ run
// `direct` 1 job, không Orchestrator; người gửi KHÔNG được dùng ⇒ về Orchestrator (không 403, không job assistant: delegate ⇒
// `skipped not_allowed`); `@orchestrator x` ⇒ Orchestrator dù có agent mặc định.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { type Keys, makeKeys, type Sql, sign, T, USERS, type UserKey } from "../H1/_fixtures";
import { AG, type HubX, insertConv, runIdOf, runRow, send, testRedis } from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import { type H2bExtra, jobsOf, settleRuns, setupH2b, startHubH2b } from "../H2b/_h2b";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;

beforeAll(async () => {
  sql = await setupH2b();
  // Agent mặc định của acme = assistant (trước khi Hub nạp ảnh cấu hình).
  await sql`insert into hub.tenant_agent_defaults (tenant_id, default_agent_id, fallback_agent_id, on_no_match)
    values (${T.acme}, ${AG.assistant}, null, 'answer')`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  k = await makeKeys();
  hub = await startHubH2b(k, { fastRoute: true } as H2bExtra);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

async function start(who: UserKey, content: string) {
  const conv = await insertConv(sql, who, crypto.randomUUID());
  const s = await send(hub, await sign(k, USERS[who]), conv, content);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s) };
}

describe("chat-fast2 · agent mặc định của tenant [HUB-BR-03]", () => {
  it("HUB-FR-77 · lan được dùng assistant (AU 3) ⇒ run direct 1 job assistant, 0 job Orchestrator", async () => {
    const x = await start("lan", "Hỏi chung");
    const job = await rt.next(x.runId);
    expect(job.payload.agent).toEqual({ id: AG.assistant, key: "assistant", role: "agent" });
    await rt.agent(job, { status: "done", text: "Đáp." });
    const end = await x.s.terminal(15_000);
    x.s.close();
    expect(end?.data?.content).toBe("Đáp.");
    expect(await runRow(sql, x.runId)).toMatchObject({ kind: "direct", agent_id: AG.assistant });
    expect(await jobsOf(sql, x.runId)).toEqual([{ role: "agent", key: "assistant" }]);
  });

  it("HUB-BR-03 · tadmin không được dùng assistant ⇒ về Orchestrator (không 403); delegate assistant ⇒ skipped not_allowed", async () => {
    const x = await start("tadmin", "Hỏi chung");
    const o1 = await rt.next(x.runId);
    expect(o1.payload.agent.role).toBe("orchestrator");
    await rt.decide(o1, { decision: "delegate", agent: "assistant", task: "Việc bị cấm" });
    const o2 = await rt.next(x.runId);
    expect(o2.payload.agent.role).toBe("orchestrator");
    await rt.decide(o2, echoAnswer(o2));
    expect((await x.s.terminal(15_000))?.event).toBe("run.finished");
    x.s.close();
    expect((await jobsOf(sql, x.runId)).map((j) => j.role)).toEqual([
      "orchestrator",
      "orchestrator",
    ]);
    const skipped =
      await sql`select detail from hub.run_steps where run_id = ${x.runId} and status = 'skipped'`;
    expect(skipped.map((s) => s.detail?.reason)).toEqual(["not_allowed"]);
  });

  it("HUB-FR-77 · '@orchestrator x' ⇒ Orchestrator dù có agent mặc định; prompt chỉ 'x'", async () => {
    const x = await start("lan", "@orchestrator so sánh giúp");
    const o = await rt.next(x.runId);
    expect(o.payload.agent.role).toBe("orchestrator");
    expect(o.payload.prompt).toContain("so sánh giúp");
    expect(o.payload.prompt).not.toContain("@orchestrator");
    await rt.decide(o, echoAnswer(o));
    await x.s.terminal(15_000);
    x.s.close();
    expect((await runRow(sql, x.runId))?.kind).toBe("orchestrated");
  });
});
