// CR-121 · R-2 · int: trang chi tiết lượt chạy + nhật ký một bước. platform_admin thấy debug (mã lỗi, thông điệp gốc, payload
// job, kh_stage_usage); tenant admin cùng tenant chỉ basic (JSON KHÔNG chứa payload/error_message/mã lỗi, kể cả khi gửi
// `?level=debug`); tenant khác ⇒ 404; member ⇒ 403. Số câu SQL cố định (chi tiết ≤ 4, nhật ký ≤ 3).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { RunDetailSchema, RunStageLogSchema } from "@ai/contracts/chat";
import { T } from "../../../../../../tests/acceptance/H1/_fixtures";
import { type CtxPa, PA, startPa } from "../../../../../../tests/acceptance/P-a/_support/pa";
import {
  defInput,
  insertDef,
  insertOutput,
  insertRun,
  insertTask,
} from "../../../../../../tests/acceptance/P-a/_support/process-fixtures";
import { countQueries } from "../../../../../../tests/acceptance/P-d/d1/_count";
import { AGB, type Json } from "../../../../../../tests/acceptance/X2b/_x2b";

const DEF = "c1212000-0000-4000-8000-000000000001";
const SECRET_MSG = "SECRET-RUN-MSG-7f3a";
const SECRET_JOB = "SECRET-JOB-MSG-7f3a";
const SECRET_PAYLOAD = "SECRET-PAYLOAD-7f3a";
const OUT_TEXT = "SECRET-OUTPUT-7f3a";
const COMMENT = "Cần sửa số tiền ở mục 2";

let c: CtxPa;
let runId = "";
let stageRunId = "";

beforeAll(async () => {
  c = await startPa();
  const di = defInput({ key: "cr121-log", name: "Hoá đơn R2" });
  await insertDef(c.sql, { id: DEF, tenantId: T.acme, input: di });
  const run = await insertRun(c.sql, {
    def: { id: DEF, key: "cr121-log", name: "Hoá đơn R2", stages: di.stages as Json[] },
    startedBy: PA.A,
    status: "needs_decision",
    decision: { reason: "agent_failed", stage_idx: 0, options: ["add_attempt", "cancel"] },
  });
  runId = run.runId;
  stageRunId = run.stageRunIds[0] as string;
  await c.sql`update hub.process_runs set started_at = now() - interval '5 minutes' where id = ${runId}`;
  await c.sql`update hub.stage_runs set started_at = now() - interval '3 minutes',
      finished_at = now() - interval '1 minute', last_error_code = 'TIMEOUT', status = 'needs_decision'
    where id = ${stageRunId}`;
  const outputId = await insertOutput(c.sql, {
    tid: T.acme,
    runId,
    stageRunId,
    stageIdx: 0,
    content: OUT_TEXT,
  });
  const task = await insertTask(c.sql, {
    tid: T.acme,
    runId,
    stageRunId,
    kind: "review",
    outputId,
    userIds: [PA.B.id],
  });
  await c.sql`update hub.review_tasks set status = 'closed', result = 'fail', feedback = ${COMMENT},
      decided_by = ${PA.B.id}, decided_at = now() - interval '2 minutes' where id = ${task}`;
  const [rid, jid] = [crypto.randomUUID(), crypto.randomUUID()];
  await c.sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, error_code, error_message, error_hint, process_run_id, stage_run_id, tokens_used, finished_at)
    values (${rid}, ${T.acme}, ${PA.A.id}, ${run.convId}, ${run.flowId}, 'failed', 1, ${crypto.randomUUID()},
      ${crypto.randomUUID()}, 'TIMEOUT', ${SECRET_MSG}, 'hint', ${runId}, ${stageRunId}, 42, now())`;
  await c.sql`insert into hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
      provider_key, payload, status, attempts, error_code, error_reason, error_message, started_at, finished_at)
    values (${jid}, ${T.acme}, ${PA.A.id}, ${rid}, ${crypto.randomUUID()}, ${run.convId}, ${AGB.hoadon},
      'agent.cli', 'claude-sub', ${c.sql.json({ prompt: SECRET_PAYLOAD })}, 'failed', 2, 'TIMEOUT', 'timeout',
      ${SECRET_JOB}, now(), now())`;
  await c.sql`insert into hub.kh_stage_usage (stage_run_id, attempt, round, tenant_id, queries)
    values (${stageRunId}, 1, 1, ${T.acme}, 4)`;
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const logPath = (q = "") => `/process-runs/${runId}/stages/0/log${q}`;
const asP = `?tenant_id=${T.acme}`;

describe("CR-121 R-2 · nhật ký một bước", () => {
  it("platform_admin ⇒ debug: mã lỗi, thông điệp gốc, các lần thử, payload job, số truy vấn KH", async () => {
    const r = await c.call("P", "GET", logPath(asP));
    expect(r.status).toBe(200);
    const log = RunStageLogSchema.parse(r.json);
    expect(log.level).toBe("debug");
    expect(log.debug?.last_error_code).toBe("TIMEOUT");
    expect(log.debug?.kh_queries).toBe(4);
    const att = log.debug?.attempts[0];
    expect(att?.error_message).toBe(SECRET_MSG);
    expect(att?.jobs[0]?.error_message).toBe(SECRET_JOB);
    expect(att?.jobs[0]?.payload).toEqual({ prompt: SECRET_PAYLOAD });
    expect(att?.jobs[0]?.attempts).toBe(2);
    expect(log.tasks[0]?.comment).toBe(COMMENT);
    expect(log.outputs[0]?.content).toBe(OUT_TEXT);
  });

  it("tenant admin cùng tenant ⇒ basic: có người xử lý/kết quả/bình luận/lỗi dễ hiểu, KHÔNG payload/error_message/mã lỗi", async () => {
    for (const q of ["", "?level=debug", `?level=debug&tenant_id=${T.beta}`]) {
      const r = await c.call("Adm", "GET", logPath(q));
      expect(r.status).toBe(200);
      const log = RunStageLogSchema.parse(r.json);
      expect(log.level).toBe("basic");
      expect(log.debug).toBeUndefined();
      expect(r.text).not.toContain("SECRET-");
      expect(r.text).not.toContain("payload");
      expect(r.text).not.toContain("error_message");
      expect(r.text).not.toContain("TIMEOUT");
      expect(r.text).not.toContain("last_error_code");
      expect(log.tasks[0]).toMatchObject({
        status: "closed",
        result: "fail",
        comment: COMMENT,
        decided_by: { id: PA.B.id },
      });
      expect(log.tasks[0]?.outcome?.vi).toContain("làm lại");
      expect(log.error_text?.vi).toContain("quá thời gian");
      expect(log.stage.state).toBe("needs_decision");
    }
  });

  it("nhật ký: tenant khác 404, member 403, chỉ số bước hoặc uuid sai 404", async () => {
    expect((await c.call("Db", "GET", logPath())).status).toBe(404);
    expect((await c.call("A", "GET", logPath())).status).toBe(403);
    expect((await c.call("Adm", "GET", `/process-runs/${runId}/stages/9/log`)).status).toBe(404);
    expect((await c.call("Adm", "GET", "/process-runs/not-a-uuid/stages/0/log")).status).toBe(404);
  });

  it("nhật ký ≤ 3 câu SQL (debug) và ≤ 2 (basic)", async () => {
    const dbg = await countQueries(c.hub, () => c.call("P", "GET", logPath(asP)));
    expect(dbg.r.status).toBe(200);
    expect(dbg.n).toBeLessThanOrEqual(3);
    const basic = await countQueries(c.hub, () => c.call("Adm", "GET", logPath()));
    expect(basic.r.status).toBe(200);
    expect(basic.n).toBeLessThanOrEqual(2);
  });
});

describe("CR-121 R-2 · chi tiết lượt chạy", () => {
  it("header + bước + dòng thời gian cho tenant admin và platform_admin", async () => {
    const r = await c.call("Adm", "GET", `/process-runs/${runId}/detail`);
    expect(r.status).toBe(200);
    const d = RunDetailSchema.parse(r.json);
    expect(d.tenant.id).toBe(T.acme);
    expect(d.tenant.name.length).toBeGreaterThan(0);
    expect(d.started_by?.id).toBe(PA.A.id);
    expect(d.origin.kind).toBe("admin");
    expect(d.status).toBe("needs_decision");
    expect(d.decision_reason).toBe("agent_failed");
    expect(d.status_text.vi).toContain("Cần người quyết định");
    expect(d.steps).toHaveLength(2);
    expect(d.steps[0]).toMatchObject({ state: "needs_decision", idx: 0 });
    expect(d.steps[0]?.duration_ms).toBe(120_000);
    expect(d.steps[1]?.state).toBe("not_reached");
    expect(d.timeline[0]?.kind).toBe("started");
    expect(d.timeline.map((t) => t.kind)).toContain("review");
    expect(d.timeline.map((t) => t.kind)).toContain("error");
    expect(r.text).not.toContain("TIMEOUT");
    expect(r.text).not.toContain("SECRET-");
    const p = await c.call("P", "GET", `/process-runs/${runId}/detail${asP}`);
    expect(p.status).toBe(200);
    expect(RunDetailSchema.parse(p.json).id).toBe(runId);
  });

  it("chi tiết: tenant khác 404, member 403", async () => {
    expect((await c.call("Db", "GET", `/process-runs/${runId}/detail`)).status).toBe(404);
    expect((await c.call("A", "GET", `/process-runs/${runId}/detail`)).status).toBe(403);
  });

  it("chi tiết ≤ 4 câu SQL cố định, không theo số bước", async () => {
    const q = await countQueries(c.hub, () =>
      c.call("Adm", "GET", `/process-runs/${runId}/detail`),
    );
    expect(q.r.status).toBe(200);
    expect(q.n).toBeLessThanOrEqual(4);
  });
});
