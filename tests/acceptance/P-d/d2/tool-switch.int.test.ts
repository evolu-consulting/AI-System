// AC-H47 · HUB-FR-146 · TT-R04…R08 · plan-d2 §10 S2/S9/S10 (hard stop) · test-plan-d2 §3.2 PD2-I20…I26: công tắc tool theo tenant +
// cách ly 2 tenant. `hub_ro` policy `USING (true)` ⇒ lọc `tenant_id = run.tenant_id` tường minh là rào DUY NHẤT: bật ở beta,
// chạy ở acme ⇒ `tool_failed`, Dify 0 lời gọi. Kiểm `canRun` NGAY trước gọi (S10). Chờ tool-driver bằng `handles.settled()`.
// Thiếu 0012/0037/contract ⇒ đỏ NGAY ở `needD2` ("chưa có tính năng: … (T17|T18a)").
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  createDef,
  decisionOf,
  defBody,
  jobDone,
  mdOut,
  nextStageJob,
  PA,
  startRun,
  waitStageStatus,
} from "../_support/pd";
import {
  ACME,
  BETA,
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
/** Def acme s0 agent (fields tong_tien) → s1 tool W; trả key. */
async function toolDef(tool_key: string = WF.W.key, role: "Adm" = "Adm"): Promise<string> {
  const key = `pd2-sw-${++seq}`;
  await createDef(
    c,
    defBody(key, [agentStage({ key: "s0", step: 0, fields: FIELDS }), toolStage({ tool_key })], {
      inputs: MA_KH_INPUT,
    }),
    role,
  );
  return key;
}
/** Chạy tới khi s0 xong (tool-driver đã xử lý xong s1 — tín hiệu `settled`). */
async function runToTool(key: string, beforeS0Done?: () => Promise<void>): Promise<string> {
  const runId = await startRun(c, key, { inputs: [{ type: "text", key: "ma-kh", value: "KH1" }] });
  const job = await nextStageJob(c, runId);
  await beforeS0Done?.();
  await jobDone(c, job, mdOut({ tong_tien: 25_000_000 }));
  await waitStageStatus(c.sql, runId, 0, "done");
  await settled(c);
  return runId;
}
async function prep(): Promise<void> {
  await needD2(c);
  await insertWorkflows(c.sql, c.dify.baseUrl);
  c.dify.calls.length = 0;
}

describe("AC-H47 · catalog + lưu def theo tenant [TT-R04]", () => {
  it("AC-H47 · PD2-I20 · W bật acme, chưa bật beta ⇒ editor acme thấy W, beta không; beta lưu def dùng W ⇒ 422 PROCESS_REF_INVALID", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const a = await c.call("Adm", "GET", "/process-editor/context");
    expect(((a.json?.tools ?? []) as { key: string }[]).map((t) => t.key)).toEqual([WF.W.key]);
    const b = await c.call("D", "GET", "/process-editor/context");
    expect(b.json?.tools ?? []).toEqual([]);
    const res = await c.call(
      "D",
      "POST",
      "/process-defs",
      defBody("pd2-beta", [agentStage({ key: "s0", step: 0, fields: FIELDS }), toolStage()], {
        inputs: MA_KH_INPUT,
      }),
    );
    expect({
      status: res.status,
      code: res.json?.error?.code,
      ref: res.json?.error?.details?.ref,
    }).toEqual({
      status: 422,
      code: "PROCESS_REF_INVALID",
      ref: "tool",
    });
  }, 30_000);
});

describe("AC-H47 · S9 · cách ly 2 tenant — lọc tenant_id tường minh (hub_ro USING(true))", () => {
  it("AC-H47 · PD2-I21 · run acme ở s0 ⇒ tắt W cho acme ⇒ s1 needs_decision tool_failed, Dify 0 lời gọi", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    const runId = await runToTool(key, () => setSwitch(c.sql, "W", ACME, false));
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
    expect(c.dify.calls).toHaveLength(0);
  }, 30_000);
  it("AC-H47 · PD2-I23 · S9 · W tắt ở acme, BẬT ở beta ⇒ run acme mới vẫn tool_failed, Dify 0 lời gọi (công tắc đọc theo run.tenant_id)", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    await setSwitch(c.sql, "W", ACME, false);
    await setSwitch(c.sql, "W", BETA, true);
    const runId = await runToTool(key);
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
    expect(c.dify.calls).toHaveLength(0);
  }, 30_000);
  it("AC-H47 · PD2-I24 · admin.workflows.enabled=false khi run chờ ⇒ tool_failed, 0 lời gọi", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    const runId = await runToTool(key, async () => {
      await c.sql`update admin.workflows set enabled = false where id = ${WF.W.id}`;
    });
    await c.sql`update admin.workflows set enabled = true where id = ${WF.W.id}`;
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
    expect(c.dify.calls).toHaveLength(0);
  }, 30_000);
});

describe("AC-H47 · S10 · quyền chạy kiểm ngay trước gọi [PD2-R03, L7]", () => {
  it("AC-H47 · PD2-I25 · người bắt đầu không có agent grant, thuộc Group chạy ⇒ Dify 1 lời gọi bằng difyUser của người bắt đầu", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    const runId = await runToTool(key);
    expect(c.dify.calls).toHaveLength(1);
    expect(c.dify.calls[0]?.user).toContain(PA.A.id);
    expect(c.dify.calls[0]?.inputs).toEqual({ tong_tien: 25_000_000, ma_kh: "KH1" });
    expect(await decisionOf(c.sql, runId)).toBeUndefined();
  }, 30_000);
  it("AC-H47 · PD2-I26 · thu hồi Group chạy quy trình của A khi run ở s0 ⇒ permission_lost, 0 lời gọi", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    const runId = await runToTool(key, async () => {
      await c.sql`update hub.process_defs set run_group_ids = ${c.sql.array([WF.WOFF.id])} where key = ${key}`;
    });
    expect((await decisionOf(c.sql, runId))?.reason).toBe("permission_lost");
    expect(c.dify.calls).toHaveLength(0);
  }, 30_000);
});
