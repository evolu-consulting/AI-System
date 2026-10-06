// HUB-FR-52 · HUB-FR-87 · AC-H08 · H3b-R16–R20, R49 · HUB-H3b-AC-08…11 · test-plan-cases H3b §2.7 A90–A102: GET
// `/runs/:id/trace` — chủ run xem (0 audit), không phải chủ ⇒ 404 giống hệt (cả tenant_admin, Q-U2), platform_admin xem
// mọi tenant + 1 audit `view_trace` mỗi lần (fail-closed), che `detail`/không trả payload job, cắt 200, lọc tenant (K10).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { RunSchema } from "@ai/contracts/chat";
import { MASK, type RunTrace, RunTraceSchema } from "@ai/contracts/hub-admin";
import { call, type Res } from "../H1/_fixtures";
import {
  auditSince,
  type Ctx,
  e,
  errOf,
  expectSame404,
  failingAudit,
  idGen3,
  NONE,
  startH3b,
  startHubH3b,
  stateOf,
  T,
  tok,
  traceOf,
  USERS,
} from "./_h3b";
import {
  ERR_DETAIL,
  insertTraceRun,
  MSG_MARK,
  PLANTED_ALL,
  STEP_MS,
  type TraceRun,
  USAGE_TOTAL,
} from "./_h3b-trace";

let x: Ctx;
const id = idGen3(4000);
const RUN = { lan: id(), beta: id(), tam: id(), pad: id(), tad: id(), big: id(), mix: id() };
const tr: Record<string, TraceRun> = {};
beforeAll(async () => {
  x = await startH3b();
  tr.lan = await insertTraceRun(x.sql, "lan", RUN.lan, { base: 5000 });
  tr.beta = await insertTraceRun(x.sql, "an", RUN.beta, { base: 5100 });
  tr.tam = await insertTraceRun(x.sql, "tam", RUN.tam, { base: 5200 });
  tr.pad = await insertTraceRun(x.sql, "padmin", RUN.pad, { base: 5300 });
  tr.tad = await insertTraceRun(x.sql, "tadmin", RUN.tad, { base: 5400 });
  tr.big = await insertTraceRun(x.sql, "lan", RUN.big, { base: 6000, steps: 201, jobs: 201 });
  tr.mix = await insertTraceRun(x.sql, "lan", RUN.mix, { base: 7000 });
}, 120_000);
afterAll(async () => {
  await x?.stop();
});

function parsed(res: Res): RunTrace {
  expect(res.status).toBe(200);
  return RunTraceSchema.parse(res.json);
}
const stepOf = (t: RunTrace, seq: number) => t.steps.find((s) => s.seq === seq);
/** Quét thân + hàng audit: không chuỗi bí mật mẫu. */
function expectNoPlanted(text: string): void {
  for (const p of PLANTED_ALL) expect({ p, hit: text.includes(p) }).toEqual({ p, hit: false });
}

describe("A90–A92 · chủ run / không phải chủ [HUB-FR-52 · AC-H08 · H3b-R17 · HUB-H3b-AC-08, AC-10]", () => {
  it("HUB-FR-52 · A90 · lan · R_lan; tadmin · R_tad ⇒ 200 RunTrace: steps theo seq + ms, jobs, usage gắn step, usage_total gồm dòng NULL, messages; 0 audit [H3b-R17, R18 · HUB-H3b-AC-08]", async () => {
    const a0 = (await stateOf(x.sql)).audit;
    const t = parsed(await traceOf(x, "lan", RUN.lan));
    expect(t.run).toMatchObject({
      id: RUN.lan,
      tenant_id: T.acme,
      user_id: USERS.lan.id,
      status: "finished",
    });
    expect(t.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(t.steps.map((s) => s.type)).toEqual([
      "orchestrator",
      "delegate",
      "workflow",
      "tool",
      "delegate",
    ]);
    expect(t.steps.map((s) => s.ms)).toEqual([STEP_MS, STEP_MS, STEP_MS, STEP_MS, STEP_MS]);
    expect(stepOf(t, 2)?.agent?.key).toBe("hoadon");
    expect(stepOf(t, 3)?.agent).toBeNull();
    expect(t.jobs.map((j) => j.id).sort()).toEqual([...(tr.lan?.jobs ?? [])].sort());
    expect(stepOf(t, 1)?.usage).toMatchObject({
      model: "haiku",
      input_tokens: 100,
      output_tokens: 20,
      cost_usd: "0.001000",
    });
    expect(stepOf(t, 3)?.usage).toBeNull();
    expect({
      i: t.usage_total.input_tokens,
      o: t.usage_total.output_tokens,
      m: t.usage_total.model,
    }).toEqual({
      i: USAGE_TOTAL.input_tokens,
      o: USAGE_TOTAL.output_tokens,
      m: null,
    });
    expect(t.messages.user?.content).toContain(MSG_MARK);
    expect(t.messages.answer?.id).toBe(tr.lan?.answerMsg);
    expect(t.truncated).toBe(false);
    expect(parsed(await traceOf(x, "tadmin", RUN.tad)).run.user_id).toBe(USERS.tadmin.id);
    expect(await auditSince(x.sql, a0)).toEqual([]);
  });

  it('AC-H08 · A91 · lan/tadmin → R_beta, badmin → R_lan ⇒ 404 ≡ id không có ≡ "abc"; 0 audit [H3b-R17 · HUB-BR-14 · G1]', async () => {
    expect((await traceOf(x, "lan", RUN.lan)).status).toBe(200);
    const a0 = (await stateOf(x.sql)).audit;
    const none = await traceOf(x, "lan", NONE);
    expectSame404(await traceOf(x, "lan", "abc"), none);
    expectSame404(await traceOf(x, "lan", RUN.beta), none);
    expectSame404(await traceOf(x, "tadmin", RUN.beta), none);
    expectSame404(await traceOf(x, "badmin", RUN.lan), none);
    expect(await auditSince(x.sql, a0)).toEqual([]);
  });

  it("HUB-FR-52 · A92 · tadmin · R_lan (cùng tenant, không phải chủ); hoa · R_lan ⇒ 404 ≡; 0 audit (Q-U2) [H3b-R17]", async () => {
    expect((await traceOf(x, "lan", RUN.lan)).status).toBe(200);
    const a0 = (await stateOf(x.sql)).audit;
    const none = await traceOf(x, "tadmin", NONE);
    expectSame404(await traceOf(x, "tadmin", RUN.lan), none);
    expectSame404(await traceOf(x, "hoa", RUN.lan), none);
    expect(await auditSince(x.sql, a0)).toEqual([]);
  });
});

describe("A93–A96 · platform_admin + audit view_trace [HUB-FR-87 · H3b-R16, R17 · HUB-H3b-AC-09]", () => {
  it("HUB-FR-87 · A93 · padmin · R_lan ×2 ⇒ 200 đầy đủ ×2; đúng 2 hàng view_trace (tenant acme, actor padmin, entity run, summary {run_user_id, run_status}) [H3b-R16 · HUB-H3b-AC-09]", async () => {
    const a0 = (await stateOf(x.sql)).audit;
    for (let i = 0; i < 2; i++)
      expect(parsed(await traceOf(x, "padmin", RUN.lan)).steps.length).toBe(5);
    const rows = await auditSince(x.sql, a0);
    expect(rows.length).toBe(2);
    for (const r of rows)
      expect({
        action: r.action,
        tenant_id: r.tenant_id,
        actor_id: r.actor_id,
        actor_role: r.actor_role,
        entity: r.entity,
        entity_id: r.entity_id,
        entity_name: r.entity_name,
        hub_config_version: r.hub_config_version,
        before: r.before,
        after: r.after,
        summary: r.summary,
      }).toEqual({
        action: "view_trace",
        tenant_id: T.acme,
        actor_id: USERS.padmin.id,
        actor_role: "platform_admin",
        entity: "run",
        entity_id: RUN.lan,
        entity_name: "",
        hub_config_version: null,
        before: null,
        after: null,
        summary: { run_user_id: USERS.lan.id, run_status: "finished" },
      });
  });

  it("HUB-FR-87 · A94 · padmin · R_beta ⇒ 200; audit tenant_id = beta [H3b-R16]", async () => {
    const a0 = (await stateOf(x.sql)).audit;
    expect(parsed(await traceOf(x, "padmin", RUN.beta)).run.tenant_id).toBe(T.beta);
    expect((await auditSince(x.sql, a0)).map((r) => [r.action, r.tenant_id])).toEqual([
      ["view_trace", T.beta],
    ]);
  });

  it("HUB-FR-87 · A95 · padmin · R_pad (run của chính mình) ⇒ 200; 0 audit (Q-U4) [H3b-R17]", async () => {
    const a0 = (await stateOf(x.sql)).audit;
    expect(parsed(await traceOf(x, "padmin", RUN.pad)).run.user_id).toBe(USERS.padmin.id);
    expect(await auditSince(x.sql, a0)).toEqual([]);
  });

  it("HUB-FR-87 · A96 · padmin · id không có ⇒ 404; 0 audit (PL11) [H3b-R17]", async () => {
    expect((await traceOf(x, "padmin", RUN.pad)).status).toBe(200);
    const a0 = (await stateOf(x.sql)).audit;
    expect(errOf(await traceOf(x, "padmin", NONE))).toEqual(e(404, "NOT_FOUND"));
    expect(await auditSince(x.sql, a0)).toEqual([]);
  });
});

describe("A97–A102 · che, fail-closed, giới hạn, lọc tenant [HUB-FR-52 · HUB-FR-87 · H3b-R18–R20, R49 · HUB-H3b-AC-10, AC-11]", () => {
  it("HUB-FR-52 · A97 · thân 200 (lan, padmin) + hàng audit: không PLANTED; khoá nhạy cảm ⇒ MASK; jobs không payload/result/token_hash/error_message; audit không MSG_MARK [H3b-R16, R18 · HUB-H3b-AC-10]", async () => {
    const a0 = (await stateOf(x.sql)).audit;
    for (const who of ["lan", "padmin"] as const) {
      const res = await traceOf(x, who, RUN.lan);
      const t = parsed(res);
      expectNoPlanted(res.text);
      expect(stepOf(t, 1)?.detail).toEqual({
        api_key: MASK,
        headers: { Authorization: MASK },
        note: MASK,
      });
      expect(stepOf(t, 2)?.detail).toEqual({ tokenBudget: MASK });
      for (const j of t.jobs)
        for (const k of ["payload", "result", "token_hash", "error_message"])
          expect(Object.keys(j)).not.toContain(k);
    }
    const audit = JSON.stringify(await auditSince(x.sql, a0));
    expect(audit).not.toContain(MSG_MARK);
    expectNoPlanted(audit);
  });

  it("HUB-FR-52 · A97b · step lỗi detail {message, upstream, usage}: lan không thấy message/upstream (usage giữ số); padmin thấy nguyên văn + 1 audit [H3b-R49 · PL15 · H1-R26 · HUB-BR-02]", async () => {
    const own = await traceOf(x, "lan", RUN.lan);
    expect(stepOf(parsed(own), 5)?.detail).toEqual({ usage: ERR_DETAIL.usage });
    for (const s of ["MSG_ERR", "UP_ERR"]) expect(own.text).not.toContain(s);
    const a0 = (await stateOf(x.sql)).audit;
    expect(stepOf(parsed(await traceOf(x, "padmin", RUN.lan)), 5)?.detail).toEqual(ERR_DETAIL);
    expect((await auditSince(x.sql, a0)).map((r) => r.action)).toEqual(["view_trace"]);
  });

  it("HUB-FR-87 · A98 · hubAudit lỗi view_trace: padmin · R_lan ⇒ 500 INTERNAL_ERROR, thân không R_lan/MSG_MARK, 0 audit · lan · R_lan ⇒ 200 (nhánh chủ không audit) [H3b-R19 · HUB-H3b-AC-11]", async () => {
    const audit = failingAudit(["view_trace"]);
    const hub = await startHubH3b(x.k, { instanceId: "qc-hub-h3b-fail", hubAudit: audit });
    try {
      const a0 = (await stateOf(x.sql)).audit;
      const res = await call(hub, "GET", `/runs/${RUN.lan}/trace`, {
        token: await tok(x.k, "padmin"),
      });
      expect(errOf(res)).toEqual(e(500, "INTERNAL_ERROR"));
      for (const s of [MSG_MARK, "orchestrator", ...PLANTED_ALL]) expect(res.text).not.toContain(s);
      expect(audit.calls).toEqual(["view_trace"]);
      expect(await auditSince(x.sql, a0)).toEqual([]);
      const own = await call(hub, "GET", `/runs/${RUN.lan}/trace`, {
        token: await tok(x.k, "lan"),
      });
      expect(own.status).toBe(200);
      expect(audit.calls).toEqual(["view_trace"]);
    } finally {
      await hub.stop();
    }
  });

  it("HUB-FR-52 · A99 · run 201 step, 201 job ⇒ 200 step, 200 job, truncated true [H3b-R18]", async () => {
    const t = parsed(await traceOf(x, "lan", RUN.big));
    expect({ s: t.steps.length, j: t.jobs.length, tr: t.truncated }).toEqual({
      s: 200,
      j: 200,
      tr: true,
    });
    expect(t.steps.at(-1)?.seq).toBe(200);
  });

  it("HUB-FR-87 · A100 · owner chèn jobs/usage cùng run_id nhưng tenant beta ⇒ padmin và lan không thấy, usage_total không cộng (K10) [H3b-R17 · plan-db §5]", async () => {
    const r = tr.mix;
    const jobId = id();
    await x.sql`insert into hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
        provider_key, payload, status)
      select ${jobId}, ${T.beta}, ${USERS.an.id}, j.run_id, j.step_id, j.conversation_id, j.agent_id, j.type,
        j.provider_key, '{}'::jsonb, 'succeeded' from hub.jobs j where j.id = ${r?.jobs[0] ?? NONE}`;
    await x.sql`insert into hub.usage_logs (tenant_id, run_id, step_id, billing, input_tokens, output_tokens, cost_usd)
      values (${T.beta}, ${RUN.mix}, ${r?.steps[0] ?? NONE}, 'subscription', 1000, 1000, 1.5),
             (${T.beta}, ${RUN.mix}, null, 'subscription', 1000, 1000, 1.5)`;
    for (const who of ["lan", "padmin"] as const) {
      const t = parsed(await traceOf(x, who, RUN.mix));
      expect(t.jobs.map((j) => j.id)).not.toContain(jobId);
      expect({ i: t.usage_total.input_tokens, o: t.usage_total.output_tokens }).toEqual({
        i: USAGE_TOTAL.input_tokens,
        o: USAGE_TOTAL.output_tokens,
      });
      expect(stepOf(t, 1)?.usage?.input_tokens).toBe(100);
    }
  });

  it("HUB-FR-52 · A101 · GET /runs/R_lan của lan ⇒ thân parse strict RunSchema chat (không trường trace — R20) [H3b-R20]", async () => {
    const res = await call(x.hub, "GET", `/runs/${RUN.lan}`, { token: await tok(x.k, "lan") });
    expect(res.status).toBe(200);
    const p = RunSchema.safeParse(res.json);
    expect(p.success).toBe(true);
    for (const k of ["steps", "jobs", "usage_total", "messages"])
      expect(Object.keys(res.json ?? {})).not.toContain(k);
  });

  it("HUB-FR-52 · A102 · step 2 có một dòng usage cost_usd NULL ⇒ cost_usd null ở step đó; số khác dạng DecimalString [H3b-R18]", async () => {
    const t = parsed(await traceOf(x, "lan", RUN.lan));
    expect(stepOf(t, 2)?.usage).toMatchObject({
      input_tokens: 55,
      output_tokens: 11,
      cost_usd: null,
    });
    expect(stepOf(t, 1)?.usage?.cost_usd).toMatch(/^-?\d+(\.\d+)?$/);
  });
});
