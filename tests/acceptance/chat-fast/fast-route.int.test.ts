// HUB-FR-77 · HUB-BR-03 · chat-fast: `fastRoute` bật — tin không tag mà AU đúng 1 agent ⇒ run `direct` (1 job agent, 0 job
// Orchestrator); quyền y hệt đường Orchestrator: agent người gửi KHÔNG được dùng (thiếu grant / tenant mất entitlement) ⇒ không
// đi thẳng, và Orchestrator delegate tới nó ⇒ step `skipped not_allowed`, 0 job agent đó. AU ≥ 2 ⇒ vẫn qua Orchestrator.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  type Keys,
  makeKeys,
  type Sql,
  sign,
  T,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import {
  AG,
  type HubX,
  hubConfigChange,
  insertConv,
  runIdOf,
  runRow,
  send,
  testRedis,
} from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import { type H2bExtra, jobsOf, menuKeys, settleRuns, setupH2b, startHubH2b } from "../H2b/_h2b";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;

beforeAll(async () => {
  sql = await setupH2b();
  k = await makeKeys();
  const extra = { fastRoute: true } as H2bExtra;
  hub = await startHubH2b(k, extra);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

const tok = (who: UserKey) => sign(k, USERS[who]);

async function start(who: UserKey, content: string) {
  const conv = await insertConv(sql, who, crypto.randomUUID());
  const s = await send(hub, await tok(who), conv, content);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s) };
}

/** Đổi cấu hình rồi chờ cache Hub thấy AU mới của `who` (GET /agents đọc cùng cache). */
async function setAu(who: UserKey, want: string[], apply: Parameters<typeof hubConfigChange>[1]) {
  await hubConfigChange(sql, apply);
  const token = await tok(who);
  await waitFor(
    () => menuKeys(hub, token),
    (keys) => JSON.stringify(keys) === JSON.stringify(want),
    5_000,
  );
}

const grantTadmin = (tx: Parameters<Parameters<typeof hubConfigChange>[1]>[0]) =>
  tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
    values (${AG.assistant}, ${T.acme}, 'user', ${USERS.tadmin.id})`;
const revokeTadmin = (tx: Parameters<Parameters<typeof hubConfigChange>[1]>[0]) =>
  tx`delete from hub.agent_grants where agent_id = ${AG.assistant} and subject_id = ${USERS.tadmin.id}`;

/** Đường Orchestrator: delegate `assistant` bị từ chối (skipped not_allowed) rồi answer; 0 job assistant trong run. */
async function expectDelegateDenied(runId: string) {
  const o1 = await rt.next(runId);
  expect(o1.payload.agent.role).toBe("orchestrator");
  await rt.decide(o1, { decision: "delegate", agent: "assistant", task: "Việc bị cấm" });
  const o2 = await rt.next(runId);
  expect(o2.payload.agent.role).toBe("orchestrator");
  await rt.decide(o2, echoAnswer(o2));
  expect((await jobsOf(sql, runId)).map((j) => j.role)).toEqual(["orchestrator", "orchestrator"]);
  const skipped =
    await sql`select detail from hub.run_steps where run_id = ${runId} and status = 'skipped'`;
  expect(skipped.map((s) => s.detail?.reason)).toEqual(["not_allowed"]);
  expect((await runRow(sql, runId))?.kind).toBe("orchestrated");
}

describe("chat-fast · định tuyến nhanh, quyền như đường Orchestrator [HUB-BR-03]", () => {
  it("HUB-FR-77 · AU = {assistant} ⇒ run direct: 1 job agent assistant, 0 job Orchestrator, responder, content", async () => {
    await setAu("tadmin", ["assistant"], grantTadmin);
    try {
      const x = await start("tadmin", "Câu hỏi nhanh");
      const job = await rt.next(x.runId);
      expect(job.payload.agent).toEqual({ id: AG.assistant, key: "assistant", role: "agent" });
      expect(job.payload.prompt).toBe("Câu hỏi nhanh");
      await rt.agent(job, { status: "done", text: "Trả lời nhanh." });
      const end = await x.s.terminal(15_000);
      x.s.close();
      expect(end?.event).toBe("run.finished");
      expect(end?.data?.content).toBe("Trả lời nhanh.");
      expect(await runRow(sql, x.runId)).toMatchObject({ kind: "direct", agent_id: AG.assistant });
      expect(await jobsOf(sql, x.runId)).toEqual([{ role: "agent", key: "assistant" }]);
    } finally {
      await setAu("tadmin", [], revokeTadmin);
    }
  });

  it("HUB-BR-03 · không grant (AU rỗng) ⇒ không đi thẳng; Orchestrator delegate assistant ⇒ skipped not_allowed", async () => {
    const x = await start("tadmin", "Nhờ trợ lý");
    await expectDelegateDenied(x.runId);
    await x.s.terminal(15_000);
    x.s.close();
  });

  it("HUB-BR-03 · có grant nhưng tenant mất entitlement ⇒ không đi thẳng; delegate ⇒ skipped not_allowed", async () => {
    await setAu("tadmin", ["assistant"], grantTadmin);
    const revoke = (tx: Parameters<Parameters<typeof hubConfigChange>[1]>[0]) =>
      tx`update hub.agent_entitlements set revoked_at = now() where agent_id = ${AG.assistant} and tenant_id = ${T.acme}`;
    const restore = (tx: Parameters<Parameters<typeof hubConfigChange>[1]>[0]) =>
      tx`update hub.agent_entitlements set revoked_at = null where agent_id = ${AG.assistant} and tenant_id = ${T.acme}`;
    try {
      await setAu("tadmin", [], revoke);
      const x = await start("tadmin", "Nhờ trợ lý sau thu hồi");
      await expectDelegateDenied(x.runId);
      await x.s.terminal(15_000);
      x.s.close();
    } finally {
      await setAu("tadmin", ["assistant"], restore);
      await setAu("tadmin", [], revokeTadmin);
    }
  });

  it("HUB-FR-77 · AU ≥ 2 (hoa: assistant, helper) ⇒ vẫn qua Orchestrator", async () => {
    const x = await start("hoa", "Hello");
    const o = await rt.next(x.runId);
    expect(o.payload.agent.role).toBe("orchestrator");
    await rt.decide(o, echoAnswer(o));
    await x.s.terminal(15_000);
    x.s.close();
    expect((await runRow(sql, x.runId))?.kind).toBe("orchestrated");
  });
});
