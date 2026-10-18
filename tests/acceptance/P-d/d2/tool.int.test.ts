// AC-H44 · HUB-FR-146 · HUB-BR-12 · test-plan-d2 §3.1 PD2-I01, I03, I10…I14 (I13/I14: T15b): stage `tool` qua Hub thật + Dify giả. Gọi bằng người
// bắt đầu, `fields` lưu, .md có `## Kết quả` + `## Bàn giao`; 64 KB ⇒ tool_failed; lưu def sai ⇒ 422. Chờ tool-driver bằng
// `handles.settled()`. Thiếu 0012/0037/contract ⇒ đỏ NGAY ở `needD2`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  createDef,
  decide,
  decisionOf,
  defBody,
  type Json,
  jobDone,
  mdOut,
  nextStageJob,
  stageOf,
  startRun,
  waitStageStatus,
} from "../_support/pd";
import {
  ACME,
  type CtxD2,
  insertWorkflows,
  MA_KH_INPUT,
  needD2,
  setSwitch,
  settled,
  startD2,
  toolStage,
  WF,
} from "./_d2";

let c: CtxD2;
beforeAll(async () => {
  c = await startD2();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const FIELDS = [{ key: "tong_tien", type: "number", required: true }];
let seq = 0;
let ready = false;
async function prep(): Promise<void> {
  await needD2(c);
  if (!ready) {
    await insertWorkflows(c.sql, c.dify.baseUrl);
    for (const w of ["W", "WS"] as const) await setSwitch(c.sql, w, ACME, true);
    ready = true;
  }
  c.dify.calls.length = 0;
}
async function runTool(): Promise<string> {
  const key = `pd2-tool-${++seq}`;
  await createDef(
    c,
    defBody(
      key,
      [
        agentStage({ key: "s0", step: 0, fields: FIELDS }),
        toolStage(),
        agentStage({ key: "s2", step: 2 }),
      ],
      {
        inputs: MA_KH_INPUT,
      },
    ),
  );
  const runId = await startRun(c, key, { inputs: [{ type: "text", key: "ma-kh", value: "KH1" }] });
  await jobDone(c, await nextStageJob(c, runId), mdOut({ tong_tien: 25_000_000 }));
  await waitStageStatus(c.sql, runId, 0, "done");
  await settled(c);
  return runId;
}
const save = (stages: Json[]) =>
  c.call(
    "Adm",
    "POST",
    "/process-defs",
    defBody(`pd2-bad-${++seq}`, stages, { inputs: MA_KH_INPUT }),
  );
const s0 = () => agentStage({ key: "s0", step: 0, fields: FIELDS });

describe("AC-H44 · chạy stage tool", () => {
  it("AC-H44 · PD2-I01 · 1 lời gọi Dify, fields + .md lưu, run_steps type tool agent_id NULL, audit tool_call không chứa giá trị", async () => {
    await prep();
    c.dify.script([{ kind: "json", result: { so_hd: "HD-1", tong_tien: 25_000_000 } }]);
    const runId = await runTool();
    expect(c.dify.calls).toHaveLength(1);
    expect(c.dify.calls[0]?.inputs).toEqual({ tong_tien: 25_000_000, ma_kh: "KH1" });
    const s1 = await waitStageStatus(c.sql, runId, 1, "done", 0);
    const [out] = await c.sql<
      Json[]
    >`select fields from hub.process_outputs where stage_run_id = ${s1.id}`;
    expect(out?.fields).toEqual({ so_hd: "HD-1", tong_tien: 25_000_000 });
    const [st] = await c.sql<
      Json[]
    >`select s.type, s.agent_id from hub.run_steps s join hub.runs r on r.id = s.run_id
      where r.stage_run_id = ${s1.id}`;
    expect({ type: st?.type, agent: st?.agent_id ?? null }).toEqual({ type: "tool", agent: null });
    const [au] = await c.sql<
      Json[]
    >`select details::text as d from hub.audit_log where action = 'tool_call'
      and details::text like ${`%${runId}%`}`;
    expect(au?.d).toBeDefined();
    expect(au?.d).not.toContain("25000000");
    expect(au?.d).not.toContain("HD-1");
    await nextStageJob(c, runId); // s2 có job
  }, 30_000);
  it("AC-H44 · PD2-I03 · S12 · kết quả 65.537 byte ⇒ needs_decision tool_failed", async () => {
    await prep();
    c.dify.script([{ kind: "raw", text: `{"so_hd":"${"x".repeat(65_537 - 12)}"}` }]);
    const runId = await runTool();
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
  }, 30_000);
  it("AC-H44 · PD2-I14 · tool_failed không output: use_current ⇒ 409 NO_OUTPUT; add_attempt ⇒ attempt+1, gọi lại đúng 1 lần ⇒ done", async () => {
    await prep();
    c.dify.script([{ kind: "http", status: 400 }]); // PD2-I07: 400 ⇒ tool_failed ngay
    const runId = await runTool();
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
    const uc = await decide(c, "A", runId, "use_current");
    expect({ status: uc.status, code: uc.json?.error?.code }).toEqual({
      status: 409,
      code: "NO_OUTPUT",
    });
    const att = (await stageOf(c.sql, runId, 1))?.attempt as number;
    expect((await decide(c, "A", runId, "add_attempt")).status).toBe(200);
    await settled(c);
    expect(c.dify.calls).toHaveLength(2);
    const s1 = await waitStageStatus(c.sql, runId, 1, "done", 0);
    expect(s1.attempt).toBe(att + 1);
  }, 30_000);
});

describe("AC-H44 · plan-addendum A3 · Hub ép trường stage tool (ensureToolStage)", () => {
  it("AC-H44 · PD2-I13 · lưu def tool có template/required_sections/token_budget tuỳ ý ⇒ GET def trả giá trị đã ép, timeout_s giữ", async () => {
    await prep();
    const t = toolStage({ timeout_s: 45 });
    const stage = {
      ...t,
      output: { ...(t.output as Json), template: "## Tuỳ ý\n", required_sections: ["Tuỳ ý"] },
      token_budget: 5000,
    };
    const def = await createDef(
      c,
      defBody(`pd2-ep-${++seq}`, [s0(), stage], { inputs: MA_KH_INPUT }),
    );
    const g = await c.call("Adm", "GET", `/process-defs/${def.id}`);
    expect(g.status).toBe(200);
    const s = ((g.json?.stages ?? []) as Json[])[1] as Json;
    expect({
      template: s.output?.template,
      required: s.output?.required_sections,
      answerer: s.answerer,
      sources: s.sources ?? [],
      must_know: s.must_know ?? [],
      autofix: s.autofix ?? null,
      token_budget: s.token_budget,
      timeout_s: s.timeout_s,
    }).toEqual({
      template: "# {name}\n\n## Kết quả\n\n## Bàn giao\n",
      required: ["Kết quả", "Bàn giao"],
      answerer: { kind: "starter" },
      sources: [],
      must_know: [],
      autofix: null,
      token_budget: null,
      timeout_s: 45,
    });
  }, 30_000);
});

describe("AC-H44 · lưu def stage tool", () => {
  it("AC-H44 · PD2-I10 · WS (side_effect) ở stage không real_action ⇒ 422 TOOL_SIDE_EFFECT path stages.1.real_action", async () => {
    await prep();
    const r = await save([s0(), toolStage({ tool_key: WF.WS.key })]);
    expect({
      status: r.status,
      rules: r.json?.error?.details?.rules,
      paths: r.json?.error?.details?.paths,
    }).toEqual({
      status: 422,
      rules: expect.arrayContaining(["TOOL_SIDE_EFFECT"]),
      paths: expect.arrayContaining(["stages.1.real_action"]),
    });
  }, 30_000);
  it("AC-H44 · PD2-I11 · thiếu tham số required ⇒ 422 TOOL_INVALID path args.tong_tien", async () => {
    await prep();
    const r = await save([s0(), toolStage({ args: { ma_kh: { from: "const", value: "KH1" } } })]);
    expect({ status: r.status, rules: r.json?.error?.details?.rules }).toEqual({
      status: 422,
      rules: expect.arrayContaining(["TOOL_INVALID"]),
    });
    expect(r.json?.error?.details?.paths).toContain("stages.1.executor.args.tong_tien");
  }, 30_000);
  it("AC-H44 · PD2-I12 · tool_key không tồn tại / WOFF ⇒ 422 PROCESS_REF_INVALID {path executor.tool_key, ref tool}", async () => {
    await prep();
    for (const k of ["khong-ton-tai", WF.WOFF.key]) {
      const r = await save([s0(), toolStage({ tool_key: k })]);
      expect({ status: r.status, code: r.json?.error?.code, d: r.json?.error?.details }).toEqual({
        status: 422,
        code: "PROCESS_REF_INVALID",
        d: expect.objectContaining({ path: "stages.1.executor.tool_key", ref: "tool" }),
      });
    }
  }, 30_000);
});
