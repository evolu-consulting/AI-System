// HUB-BR-20 · HUB-FR-95 · AC-H22 (vế `@`) · H2b-R12 · plan §5.6 · plan-db §3 · test-plan H2b §5, cases §2 A90–A96: tool
// `side_effect` qua run `direct` (`@trello`) → `CONFIRMATION_REQUIRED`, MK 0, `ask`, 1 `pending`; tin kế không tag hoặc
// tag đơn đúng agent + "Đồng ý"/"Agree" (so trên nội dung sau tag) → `confirmed`, gọi tool đúng một lần (tiêu thụ nguyên
// tử H2a-R22); tag khác / nhiều tag / "Huỷ" → `declined`; tag sai → 404, xác nhận giữ `pending`. Xác nhận `pending` dựng
// bằng run SQL như H2a (Q-T8) cho A91, A93–A96; A90, A92 đi trọn đường `@trello`. Catalog H2a + MK.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { call, type Keys, makeKeys, type Sql, sign, T, USERS, type UserKey } from "../H1/_fixtures";
import { type HubX, insertConv, runIdOf, runRow, type Sse, send, testRedis } from "../H1/_hub";
import { ScriptRuntime } from "../H1/_runtime";
import { AG2, type Dify, startDify, WF, WF_KEY } from "../H2a/_h2a";
import {
  CONFIRM,
  claimWithToken,
  confirmations,
  endSqlRun,
  expectConfirmation,
  isConfirmation,
  jobInRun,
  toolCall,
} from "../H2a/_h2a2";
import { insertSqlJob, type SqlJob } from "../H2a/_runtime2";
import { expectAgentNotFound, settleRuns, setupH2b, startHubH2b } from "./_h2b";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
let dify: Dify;

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2b({ catalogBaseUrl: dify.baseUrl });
  // A95: hoa (en) dùng được trello
  await sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
    values (${AG2.trello}, ${T.acme}, 'user', ${USERS.hoa.id})`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

const mcpUrl = () => `${hub.base}/mcp`;
const callTrello = (token: string) => toolCall(hub, token, WF_KEY.trello, { title: "Thẻ mới" });
/** Lời gọi MK của workflow side_effect `create-trello-card` (input `title`). */
const trelloRuns = () =>
  dify.runs().filter((c) => {
    const inputs = (c.body as { inputs?: Record<string, unknown> } | null)?.inputs;
    return !!inputs && "title" in inputs;
  });
const statuses = async (flowId: string) => (await confirmations(sql, flowId)).map((c) => c.status);

/** Xác nhận `pending` bằng run SQL (agent trello gọi tool → CONFIRMATION_REQUIRED → run kết thúc). */
async function sqlPending(who: UserKey = "lan"): Promise<SqlJob> {
  const ids = () => crypto.randomUUID();
  const j = await insertSqlJob(sql, ids, {
    who,
    type: "agent.cli",
    agentId: AG2.trello,
    agentKey: "trello",
    tools: [WF_KEY.trello],
    mcpUrl: mcpUrl(),
  });
  expect(isConfirmation((await callTrello(j.token)).result)).toBe(true);
  await endSqlRun(sql, j.runId);
  return j;
}
type Reply = { s: Sse; runId: string };
async function reply(who: UserKey, conv: string, flow: string, content: string): Promise<Reply> {
  const s = await send(hub, await sign(k, USERS[who]), conv, content, flow);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s) };
}
/** Job trello có token chèn vào run (Q-T8) → gọi tool. */
async function trelloInRun(runId: string) {
  return jobInRun(sql, () => crypto.randomUUID(), runId, {
    agentId: AG2.trello,
    agentKey: "trello",
    tools: [WF_KEY.trello],
    mcpUrl: mcpUrl(),
  });
}

/** A90: '@trello Tạo thẻ' trọn đường → run direct, tool → CONFIRMATION_REQUIRED, need_input → ask, 1 pending. */
async function directPending(): Promise<{ conv: string; flowId: string }> {
  const conv = await insertConv(sql, "lan", crypto.randomUUID());
  const s = await send(hub, await sign(k, USERS.lan), conv, "@trello Tạo thẻ");
  try {
    expect(s.status).toBe(200);
    const runId = runIdOf(s);
    expect((await runRow(sql, runId))?.kind).toBe("direct");
    dify.mock.reset();
    const { job, token } = await claimWithToken(sql, rt, runId);
    expect(job.payload.agent.key).toBe("trello");
    expectConfirmation((await callTrello(token)).result, "vi");
    expect(trelloRuns().length).toBe(0);
    await rt.agent(job, {
      status: "need_input",
      question: CONFIRM.vi.question,
      choices: [...CONFIRM.vi.choices],
    });
    const end = await s.terminal(15_000);
    expect(end?.event).toBe("run.finished");
    expect(s.events.find((e) => e.event === "ask")?.data?.question).toBe(CONFIRM.vi.question);
    const flowId = s.headers.get("x-flow-id") ?? "";
    expect(await confirmations(sql, flowId)).toMatchObject([
      { status: "pending", agent_id: AG2.trello, workflow_id: WF.trello },
    ]);
    return { conv, flowId };
  } finally {
    s.close();
  }
}

describe("A90–A92 · xác nhận side_effect khi gọi thẳng @trello [AC-H22 · H2b-R12]", () => {
  it("HUB-BR-20 · A90 · lan '@trello Tạo thẻ' → run direct; tools/call create-trello-card → CONFIRMATION_REQUIRED, MK 0; need_input → SSE ask; tool_confirmations 1 pending [AC-H22 · H2b-R12]", async () => {
    await directPending();
  });

  it("HUB-FR-95 · A91 · pending của trello → 'Đồng ý' (không tag) → run orchestrated, confirmed + decided_run_id; Orchestrator giả delegate trello → tool → MK đúng 1 [AC-H22 · H2b-R12]", async () => {
    const p = await sqlPending();
    const r = await reply("lan", p.convId, p.flowId, "Đồng ý");
    try {
      expect((await runRow(sql, r.runId))?.kind).toBe("orchestrated");
      expect((await confirmations(sql, p.flowId)).map((c) => [c.status, c.decided_run_id])).toEqual(
        [["confirmed", r.runId]],
      );
      const orch = await rt.next(r.runId);
      expect(orch.payload.agent.role).toBe("orchestrator");
      await rt.decide(orch, { decision: "delegate", agent: "trello", task: "Tạo thẻ" });
      dify.mock.reset();
      const { job, token } = await claimWithToken(sql, rt, r.runId);
      expect(job.payload.agent.key).toBe("trello");
      expect(isConfirmation((await callTrello(token)).result)).toBe(false);
      expect(trelloRuns().length).toBe(1);
    } finally {
      r.s.close();
    }
  });

  it("HUB-FR-95 · A92 · '@trello Tạo thẻ' → ask → '@trello Đồng ý' cùng flow → run direct, confirmed; tool → MK 1; gọi lần 2 → CONFIRMATION_REQUIRED [AC-H22 · H2b-R12 · T4]", async () => {
    const p = await directPending();
    const r = await reply("lan", p.conv, p.flowId, "@trello Đồng ý");
    try {
      expect((await runRow(sql, r.runId))?.kind).toBe("direct");
      expect(await statuses(p.flowId)).toEqual(["confirmed"]);
      dify.mock.reset();
      const { job, token } = await claimWithToken(sql, rt, r.runId);
      expect(job.payload.agent.key).toBe("trello");
      expect(isConfirmation((await callTrello(token)).result)).toBe(false);
      expect(trelloRuns().length).toBe(1);
      expect(isConfirmation((await callTrello(token)).result)).toBe(true);
      expect(trelloRuns().length).toBe(1);
    } finally {
      r.s.close();
    }
  });
});

describe("A93–A96 · tag khác / nhiều tag / huỷ / tag sai / locale / nguyên tử [H2b-R12 · H2a-R22]", () => {
  for (const [content, kind] of [
    ["@helper Đồng ý", "direct"],
    ["@trello @helper Đồng ý", "orchestrated"],
    ["@trello Huỷ", "direct"],
  ] as const)
    it(`HUB-BR-20 · A93 · pending trello → ${JSON.stringify(content)} → run ${kind}, declined; tool sau đó → CONFIRMATION_REQUIRED, MK 0 [H2b-R12]`, async () => {
      const p = await sqlPending();
      const r = await reply("lan", p.convId, p.flowId, content);
      try {
        expect((await runRow(sql, r.runId))?.kind).toBe(kind);
        expect(await statuses(p.flowId)).toEqual(["declined"]);
        const job = await trelloInRun(r.runId);
        dify.mock.reset();
        expect(isConfirmation((await callTrello(job.token)).result)).toBe(true);
        expect(trelloRuns().length).toBe(0);
      } finally {
        r.s.close();
      }
    });

  it("HUB-BR-20 · A94 · '@nope Đồng ý' → 404 AGENT_NOT_FOUND, xác nhận vẫn pending; rồi 'Đồng ý' → confirmed [H2b-R05 · H2b-R12]", async () => {
    const p = await sqlPending();
    const res = await call(hub, "POST", `/conversations/${p.convId}/messages`, {
      token: await sign(k, USERS.lan),
      body: { content: "@nope Đồng ý", flow_id: p.flowId },
    });
    expectAgentNotFound(res);
    expect(await statuses(p.flowId)).toEqual(["pending"]);
    const r = await reply("lan", p.convId, p.flowId, "Đồng ý");
    r.s.close();
    expect(await statuses(p.flowId)).toEqual(["confirmed"]);
  });

  it("HUB-FR-95 · A95 · hoa (en): '@Trello  agree ' → confirmed (so trên nội dung sau tag, không phân biệt hoa thường) [H2b-R12]", async () => {
    const p = await sqlPending("hoa");
    const r = await reply("hoa", p.convId, p.flowId, "@Trello  agree ");
    r.s.close();
    expect((await runRow(sql, r.runId))?.kind).toBe("direct");
    expect(await statuses(p.flowId)).toEqual(["confirmed"]);
  });

  it("HUB-FR-95 · A96 · confirmed qua '@trello Đồng ý' → 5 tools/call song song → MK đúng 1 [H2a-R22 · H2b-R12]", async () => {
    const p = await sqlPending();
    const r = await reply("lan", p.convId, p.flowId, "@trello Đồng ý");
    try {
      expect(await statuses(p.flowId)).toEqual(["confirmed"]);
      const job = await trelloInRun(r.runId);
      dify.mock.reset();
      const results = await Promise.all(Array.from({ length: 5 }, () => callTrello(job.token)));
      expect(results.filter((x) => !isConfirmation(x.result))).toHaveLength(1);
      expect(trelloRuns().length).toBe(1);
    } finally {
      r.s.close();
    }
  });
});
