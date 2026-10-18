// AC-H44 · HUB-FR-146 · HUB-BR-12 · PD2-R04 · review P-d2 R-1 · test-plan-d2 §3.1b PD2-I56, I57: stage `tool` `real_action` + workflow
// `side_effect` ⇒ audit `authorize_real_action` ghi NGƯỜI DUYỆT (như stage agent / Áp: entity process_run, summary {agent_id, workflow_ids});
// không có người Đạt hợp lệ ở bước trước ⇒ KHÔNG gọi Dify (an toàn, D2-49 đề xuất). Chờ tool-driver bằng `handles.settled()`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  createDef,
  decisionOf,
  defBody,
  G1,
  type Json,
  jobDone,
  mdOut,
  nextStageJob,
  PA,
  startRun,
  waitStageStatus,
} from "../_support/pd";
import {
  ACME,
  auditsOf,
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
    await setSwitch(c.sql, "WS", ACME, true);
    ready = true;
  }
  c.dify.calls.length = 0;
}
/** s0 agent (review G1) → s1 tool `WS` real_action → s2; dừng ở review s0; trả {runId, taskId}. */
async function toReview(): Promise<{ runId: string; taskId: string }> {
  const key = `pd2-ra-${++seq}`;
  await createDef(
    c,
    defBody(
      key,
      [
        agentStage({
          key: "s0",
          step: 0,
          fields: FIELDS,
          after: { kind: "review", group_id: G1, back_to_steps: [] },
        }),
        toolStage({ tool_key: WF.WS.key, real_action: true }),
        agentStage({ key: "s2", step: 2 }),
      ],
      { inputs: MA_KH_INPUT },
    ),
  );
  const runId = await startRun(c, key, { inputs: [{ type: "text", key: "ma-kh", text: "KH1" }] });
  await jobDone(c, await nextStageJob(c, runId), mdOut({ tong_tien: 25_000_000 }));
  await waitStageStatus(c, runId, 0, "waiting_review");
  const [t] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
    and kind = 'review' and status = 'open' order by created_at desc limit 1`;
  return { runId, taskId: t?.id as string };
}
async function passAs(role: "B", taskId: string): Promise<void> {
  const res = await c.call(role, "POST", `/review-tasks/${taskId}/decision`, { result: "pass" });
  expect(res.status).toBe(200);
  await settled(c);
}

describe("AC-H44 · PD2-R04 · stage tool real_action: audit người duyệt (review P-d2 R-1)", () => {
  it("AC-H44 · PD2-I56 · B Đạt s0 ⇒ tool WS real_action chạy (Dify 1 lần) + ĐÚNG 1 audit authorize_real_action actor=B, cùng cấu trúc stage agent/Áp", async () => {
    await prep();
    c.dify.script([{ kind: "json", result: { so_hd: "HD-9" } }]);
    const { runId, taskId } = await toReview();
    await passAs("B", taskId);
    await waitStageStatus(c, runId, 1, "done", 0);
    expect(c.dify.calls).toHaveLength(1);
    const au = await auditsOf(c.sql, "authorize_real_action", runId);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({
      actor_id: PA.B.id,
      actor_role: "member",
      action: "authorize_real_action",
      entity: "process_run",
      entity_id: runId,
    });
    // Cùng trường `summary` với stage agent (`agent_id`, `workflow_ids`); tool không có agent ⇒ agent_id null (như Áp, C32).
    expect(au[0]?.summary).toHaveProperty("agent_id", null);
    expect(au[0]?.summary).toHaveProperty("workflow_ids", []);
  }, 30_000);

  it("AC-H44 · PD2-I57 · D2-49 · bước trước KHÔNG có người Đạt hợp lệ (cổng s0 không còn là review) ⇒ không gọi Dify, needs_decision tool_failed, 0 audit authorize_real_action", async () => {
    await prep();
    const { runId, taskId } = await toReview();
    // Dựng trạng thái "bước trước không đạt cổng review có người duyệt" (def cũ / dữ liệu lệch): chụp def của run đổi after s0 ⇒ auto.
    await c.sql`update hub.process_runs set snapshot = jsonb_set(snapshot, '{stages,0,after}', '{"kind":"auto"}'::jsonb)
      where id = ${runId}`;
    await passAs("B", taskId);
    expect(c.dify.calls).toHaveLength(0);
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
    expect(await auditsOf(c.sql, "authorize_real_action", runId)).toHaveLength(0);
  }, 30_000);
});
