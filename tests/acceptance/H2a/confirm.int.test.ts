// HUB-FR-95 · HUB-BR-20 · AC-H22 · H2a-R21, R22, R23 · plan-db §3 · plan-errors §5 · test-plan H2a §5 A60–A67: tool
// `side_effect` qua `/mcp` → `CONFIRMATION_REQUIRED` (content[0] JSON, content[1] câu chỉ dẫn, structuredContent), 0 lời
// gọi Dify, `tool_confirmations` pending; E12 trong cùng flow quyết định (đồng ý → confirmed cho run mới, khác → declined,
// confirmed chưa dùng → expired); tiêu thụ nguyên tử một lần; ràng buộc flow/agent/workflow; locale; nguồn cờ R23 (cột
// `admin.workflows.side_effect` thắng `workflow_flags`). Job MCP dựng bằng SQL (Q-T8): R1 = run SQL, R2/R3 = run Hub tạo.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
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
import { AG, type HubX, insertHubConfig, runIdOf, type Sse, send, testRedis } from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import {
  AG2,
  catalogChange,
  type Dify,
  idGen2,
  insertCatalog,
  insertH2aAgents,
  startDify,
  startHubH2a,
  WF,
  WF_KEY,
} from "./_h2a";
import {
  confirmations,
  endSqlRun,
  expectConfirmation,
  isConfirmation,
  jobInRun,
  MOCK_TEXT,
  toolCall,
} from "./_h2a2";
import { insertSqlJob, type SqlJob, type SqlJobOpts } from "./_runtime2";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
let dify: Dify;
const id = idGen2(8000);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  await insertH2aAgents(sql);
  // A65: agent khác cùng workflow; workflow khác cũng side_effect
  await sql`insert into hub.agent_workflows (agent_id, workflow_id) values (${AG.assistant}, ${WF.trello})`;
  await sql`insert into hub.workflow_flags (workflow_id, side_effect) values (${WF.checkInvoice}, true)`;
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

const mcpUrl = () => `${hub.base}/mcp`;
const trelloJob = (o: Partial<SqlJobOpts> = {}) =>
  insertSqlJob(sql, id, {
    type: "agent.cli",
    agentId: AG2.trello,
    agentKey: "trello",
    tools: [WF_KEY.trello],
    mcpUrl: mcpUrl(),
    ...o,
  });
const inRun = (runId: string, agent: "trello" | "assistant" | "hoadon" = "trello") =>
  jobInRun(sql, id, runId, {
    agentId: agent === "trello" ? AG2.trello : AG[agent],
    agentKey: agent,
    tools: [agent === "hoadon" ? WF_KEY.checkInvoice : WF_KEY.trello],
    mcpUrl: mcpUrl(),
  });
const callTrello = (token: string) => toolCall(hub, token, WF_KEY.trello, { title: "Thẻ mới" });
/** Lời gọi MK của workflow side_effect `create-trello-card` (input `title`; `/dich` dùng `source_text`). */
const trelloRuns = () =>
  dify.runs().filter((c) => {
    const inputs = (c.body as { inputs?: Record<string, unknown> } | null)?.inputs;
    return !!inputs && "title" in inputs;
  });

/** R1 (SQL) gọi tool → CONFIRMATION_REQUIRED → R1 kết thúc (như agent trả need_input). */
async function pendingFlow(o: Partial<SqlJobOpts> = {}): Promise<SqlJob> {
  const j = await trelloJob(o);
  const { result } = await callTrello(j.token);
  expect(isConfirmation(result)).toBe(true);
  await endSqlRun(sql, j.runId);
  return j;
}
/** E12 trả lời trong flow của `j` → run mới (Hub). SSE giữ mở tới khi gọi `close`. */
async function reply(j: SqlJob, content: string): Promise<{ s: Sse; runId: string }> {
  const s = await send(hub, await sign(k, USERS.lan), j.convId, content, j.flowId);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s) };
}
const statuses = async (flowId: string) => (await confirmations(sql, flowId)).map((c) => c.status);

describe("A60–A61 · xác nhận side_effect [AC-H22 · HUB-BR-20 · HUB-FR-95]", () => {
  it("HUB-FR-95 · A60 · trello tools/call create-trello-card → isError, content[0] = ToolConfirmationRequired (vi), content[1] câu chỉ dẫn, structuredContent; MK 0; 1 pending; bước tool failed CONFIRMATION_REQUIRED [AC-H22 · HUB-BR-20]", async () => {
    dify.mock.reset();
    const j = await trelloJob();
    const { res, result } = await callTrello(j.token);
    expect(res.status).toBe(200);
    expectConfirmation(result, "vi");
    expect(dify.runs().length).toBe(0);
    const c = await confirmations(sql, j.flowId);
    expect(c).toMatchObject([
      { status: "pending", run_id: j.runId, agent_id: AG2.trello, workflow_id: WF.trello },
    ]);
    const steps = await sql<Json[]>`select type, status, workflow_id, detail from hub.run_steps
      where run_id = ${j.runId} and type = 'tool'`;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      status: "failed",
      workflow_id: WF.trello,
      detail: { code: "CONFIRMATION_REQUIRED" },
    });
  });

  it("HUB-FR-95 · A61 · E12 'Đồng ý' trong F → R2, confirmed (decided_run_id=R2); job R2 gọi → MK đúng 1; gọi lần 2 → CONFIRMATION_REQUIRED, MK vẫn 1; trace R2 có confirmed, consumed [AC-H22 · H2a-R22]", async () => {
    const j = await pendingFlow();
    dify.mock.reset();
    const r = await reply(j, "Đồng ý");
    try {
      const c = await confirmations(sql, j.flowId);
      expect(c.map((x) => [x.status, x.decided_run_id])).toEqual([["confirmed", r.runId]]);
      const job = await inRun(r.runId);
      const first = await callTrello(job.token);
      expect(first.result).toEqual({
        content: [{ type: "text", text: MOCK_TEXT }],
        isError: false,
      });
      expect(dify.runs().length).toBe(1);
      const second = await callTrello(job.token);
      expect(isConfirmation(second.result)).toBe(true);
      expect(dify.runs().length).toBe(1);
      expect(await statuses(j.flowId)).toEqual(["consumed", "pending"]);
      const trace = JSON.stringify([
        ...(await sql`select detail from hub.run_steps where run_id = ${r.runId} order by seq`),
      ]);
      expect(trace).toContain("confirmed");
      expect(trace).toContain("consumed");
    } finally {
      r.s.close();
    }
  });
});

describe("A62–A66 · quyết định, hết hạn, nguyên tử, ràng buộc, locale [H2a-R21 · H2a-R22]", () => {
  for (const [content, want] of [
    ["  agree ", "confirmed"],
    ["Huỷ", "declined"],
    ["ok", "declined"],
    ["/dich en xin chào", "declined"],
  ] as const) {
    it(`HUB-FR-95 · A62 · trả lời ${JSON.stringify(content)} → ${want}${want === "declined" ? "; R2 gọi → CONFIRMATION_REQUIRED mới" : ""} [H2a-R22]`, async () => {
      const j = await pendingFlow();
      const r = await reply(j, content);
      try {
        expect(await statuses(j.flowId)).toEqual([want]);
        if (want === "declined") {
          const job = await inRun(r.runId);
          dify.mock.reset();
          expect(isConfirmation((await callTrello(job.token)).result)).toBe(true);
          // TC-2: chỉ đếm lời gọi workflow side_effect (create-trello-card, input `title`); `/dich` của tin trả lời
          // được phép chạy Dify bất đồng bộ (B5) và có thể tới mock sau `reset()`.
          expect(trelloRuns().length).toBe(0);
          expect(await statuses(j.flowId)).toEqual(["declined", "pending"]);
        }
      } finally {
        r.s.close();
      }
    });
  }

  it("HUB-FR-95 · A63 · confirmed nhưng R2 không gọi; R3 trong F → expired; R3 gọi → CONFIRMATION_REQUIRED [H2a-R22]", async () => {
    const j = await pendingFlow();
    const r2 = await reply(j, "Đồng ý");
    try {
      expect(await statuses(j.flowId)).toEqual(["confirmed"]);
      await rt.serve(r2.runId, async (job) => rt.decide(job, echoAnswer(job)), 10_000);
      await r2.s.terminal(5_000);
    } finally {
      r2.s.close();
    }
    const r3 = await reply(j, "Làm tiếp việc khác");
    try {
      expect(await statuses(j.flowId)).toEqual(["expired"]);
      dify.mock.reset();
      const job = await inRun(r3.runId);
      expect(isConfirmation((await callTrello(job.token)).result)).toBe(true);
      expect(dify.runs().length).toBe(0);
    } finally {
      r3.s.close();
    }
  });

  it("HUB-FR-95 · A64 · confirmed → 5 tools/call song song → MK đúng 1; 4 còn lại CONFIRMATION_REQUIRED [H2a-R22 nguyên tử]", async () => {
    const j = await pendingFlow();
    const r = await reply(j, "Đồng ý");
    try {
      const job = await inRun(r.runId);
      dify.mock.reset();
      const all = await Promise.all(Array.from({ length: 5 }, () => callTrello(job.token)));
      const ok = all.filter((x) => x.result?.isError === false).length;
      const ask = all.filter((x) => isConfirmation(x.result)).length;
      expect({ ok, ask, mk: dify.runs().length }).toEqual({ ok: 1, ask: 4, mk: 1 });
    } finally {
      r.s.close();
    }
  });

  it("HUB-FR-95 · A65 · xác nhận của flow F không dùng được cho flow G, agent khác, workflow khác (vẫn dùng được đúng bộ của nó) [H2a-R21]", async () => {
    const j = await pendingFlow();
    const r = await reply(j, "Đồng ý");
    try {
      dify.mock.reset();
      const g = await trelloJob();
      expect(isConfirmation((await callTrello(g.token)).result)).toBe(true);
      const other = await inRun(r.runId, "assistant");
      expect(isConfirmation((await callTrello(other.token)).result)).toBe(true);
      const wf = await inRun(r.runId, "hoadon");
      const inv = await toolCall(hub, wf.token, WF_KEY.checkInvoice, { x: "HD-65" });
      expect(isConfirmation(inv.result)).toBe(true);
      expect(dify.runs().length).toBe(0);
      const own = await inRun(r.runId, "trello");
      expect((await callTrello(own.token)).result?.isError).toBe(false);
      expect(dify.runs().length).toBe(1);
    } finally {
      r.s.close();
    }
  });

  it("HUB-FR-95 · A66 · run locale en → choices [Agree, Cancel] + câu hỏi/chỉ dẫn en [H2a-R21]", async () => {
    const j = await trelloJob({ locale: "en", who: "hoa" });
    const { result } = await callTrello(j.token);
    expectConfirmation(result, "en");
  });
});

describe("A67 · nguồn cờ side_effect [H2a-R23]", () => {
  it("HUB-FR-95 · A67 · không cột admin.workflows.side_effect → workflow_flags quyết (trello: confirm); thêm cột (owner) = false + reload → cột thắng: gọi thẳng Dify [H2a-R23]", async () => {
    const [col] = await sql<
      { n: number }[]
    >`select count(*)::int as n from information_schema.columns
      where table_schema = 'admin' and table_name = 'workflows' and column_name = 'side_effect'`;
    expect(col?.n).toBe(0);
    const before = await trelloJob();
    expect(isConfirmation((await callTrello(before.token)).result)).toBe(true);
    await sql`alter table admin.workflows add column side_effect boolean not null default false`;
    try {
      await catalogChange(
        sql,
        (tx) => tx`update admin.workflows set updated_at = now() where id = ${WF.trello}`,
      );
      dify.mock.reset();
      const res = await waitFor(
        async () => {
          const j = await trelloJob();
          return (await callTrello(j.token)).result;
        },
        (r) => r?.isError === false,
        5_000,
      );
      expect(res).toEqual({ content: [{ type: "text", text: MOCK_TEXT }], isError: false });
      const inv = await insertSqlJob(sql, id, {
        type: "agent.cli",
        agentId: AG.hoadon,
        agentKey: "hoadon",
        tools: [WF_KEY.checkInvoice],
        mcpUrl: mcpUrl(),
      });
      const r2 = await toolCall(hub, inv.token, WF_KEY.checkInvoice, { x: "HD-67" });
      expect(r2.result?.isError).toBe(false);
      expect(dify.runs().length).toBeGreaterThanOrEqual(2);
    } finally {
      await sql`alter table admin.workflows drop column if exists side_effect`;
      await catalogChange(
        sql,
        (tx) => tx`update admin.workflows set updated_at = now() where id = ${WF.trello}`,
      );
    }
  });
});
