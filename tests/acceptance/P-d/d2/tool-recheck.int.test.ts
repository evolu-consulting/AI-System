// AC-H47 · HUB-FR-146 · security P-d2 (review.md "Security P-d2") M1/S4 + m1 · test-plan-d2 §3.1b PD2-I53, I54: lúc CHẠY stage
// `tool` phải kiểm lại cấu hình workflow đã đổi SAU khi def lưu — `side_effect` bật mà stage không `real_action`, hoặc
// `input_schema` hỏng (catalog `/mcp` bỏ) ⇒ needs_decision `tool_failed`, Dify giả 0 lời gọi. Đổi workflow bằng owner SQL
// (admin chỉ đổi qua API sau khi def đã lưu). Chờ bằng `waitStageStatus`/`settled`, không ngủ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  createDef,
  decisionOf,
  defBody,
  jobDone,
  mdOut,
  nextStageJob,
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

/** Lưu def hợp lệ (workflow W còn `side_effect=false`, schema tốt) → `mutate` workflow → chạy tới stage tool → lý do quyết. */
async function runAfter(mutate: () => Promise<void>): Promise<string | undefined> {
  await needD2(c);
  await insertWorkflows(c.sql, c.dify.baseUrl);
  await setSwitch(c.sql, "W", ACME, true);
  const good = [
    { name: "tong_tien", type: "number", required: true, description: "Tổng tiền" },
    { name: "ma_kh", type: "text", required: false, description: "Mã KH" },
  ];
  await c.sql`update admin.workflows set side_effect = false, input_schema = ${c.sql.json(good as never)}
    where id = ${WF.W.id}`; // khôi phục trạng thái tốt của ca trước để lưu def hợp lệ
  c.dify.calls.length = 0;
  const key = `pd2-recheck-${++seq}`;
  await createDef(
    c,
    defBody(
      key,
      [
        agentStage({ key: "s0", step: 0, fields: FIELDS }),
        toolStage({ real_action: false }),
        agentStage({ key: "s2", step: 2 }),
      ],
      { inputs: MA_KH_INPUT },
    ),
  );
  await mutate();
  await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  const runId = await startRun(c, key, { inputs: [{ type: "text", key: "ma-kh", text: "KH1" }] });
  await jobDone(c, await nextStageJob(c, runId), mdOut({ tong_tien: 25_000_000 }));
  await waitStageStatus(c, runId, 0, "done");
  await settled(c);
  return (await decisionOf(c.sql, runId))?.reason;
}

describe("security P-d2 · kiểm lại workflow lúc chạy stage tool", () => {
  it("AC-H47 · PD2-I53 · M1/S4 · workflow bật side_effect SAU khi lưu def, stage không real_action ⇒ tool_failed, Dify 0 lời gọi", async () => {
    const reason = await runAfter(async () => {
      await c.sql`update admin.workflows set side_effect = true where id = ${WF.W.id}`;
    });
    expect({ reason, difyCalls: c.dify.calls.length }).toEqual({
      reason: "tool_failed",
      difyCalls: 0,
    });
  }, 30_000);
  it("AC-H47 · PD2-I54 · m1 · workflow có input_schema hỏng (catalog /mcp bỏ) ⇒ tool_failed, Dify 0 lời gọi", async () => {
    // DB CHECK `workflows_input_schema_check` buộc là MẢNG ⇒ "hỏng" = mảng có phần tử sai kiểu (InputSchemaSchema từ chối).
    const bad = [
      { name: "tong_tien", type: "khong-co-kieu-nay", required: true, description: "x" },
    ];
    const reason = await runAfter(async () => {
      await c.sql`update admin.workflows set side_effect = false,
        input_schema = ${c.sql.json(bad as never)} where id = ${WF.W.id}`;
    });
    expect({ reason, difyCalls: c.dify.calls.length }).toEqual({
      reason: "tool_failed",
      difyCalls: 0,
    });
  }, 30_000);
});
