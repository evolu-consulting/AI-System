// AC-H44 · HUB-FR-146 · PD2-R05 · Q-D2-2 · plan-d2 §4 bước 4 `failed` · test-plan-d2 §3.1 PD2-I06/I06b (T15b): lỗi mạng của stage
// tool `WS` (side_effect, stage real_action sau gate Đạt). Dify giả MỨC SOCKET (`startNetDify`): cổng giữ trước còn đóng ⇒
// ECONNREFUSED = lỗi TRƯỚC gửi ⇒ hẹn `retry`; server nhận kết nối rồi đóng socket = ĐÃ GỬI ⇒ `tool_failed`, không gọi lại.
// Hẹn bắn bằng đồng hồ giả + `sweepOnce`; chờ tool-driver bằng `handles.settled()`. Thiếu 0012/0037/contract ⇒ đỏ NGAY ở `needD2`.
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
  openTimers,
  SEC,
  startRun,
  sweepN,
  waitStageStatus,
} from "../_support/pd";
import {
  ACME,
  type CtxD2,
  insertWorkflows,
  MA_KH_INPUT,
  type NetDify,
  needD2,
  reservePort,
  setSwitch,
  settled,
  startD2,
  startNetDify,
  toolStage,
  WF,
} from "./_d2";

let c: CtxD2;
let net: NetDify;
beforeAll(async () => {
  c = await startD2();
  net = startNetDify(await reservePort());
}, 60_000);
afterAll(async () => {
  await net?.stop();
  await c?.stop();
});

const FIELDS = [{ key: "tong_tien", type: "number", required: true }];
let seq = 0;
let ready = false;
/** Mọi workflow trỏ `net.baseUrl` (cổng cố định, catalog không đổi `base_url` giữa các lần thử). */
async function prep(): Promise<void> {
  await needD2(c);
  if (!ready) {
    await insertWorkflows(c.sql, net.baseUrl);
    await setSwitch(c.sql, "WS", ACME, true);
    ready = true;
  }
}
/** s0 agent (review G1) → s1 tool `WS` real_action; B Đạt ⇒ tool-driver chạy s1; trả runId sau `settled`. */
async function runWs(): Promise<string> {
  const key = `pd2-net-${++seq}`;
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
      ],
      { inputs: MA_KH_INPUT },
    ),
  );
  const runId = await startRun(c, key, { inputs: [{ type: "text", key: "ma-kh", value: "KH1" }] });
  await jobDone(c, await nextStageJob(c, runId), mdOut({ tong_tien: 25_000_000 }));
  await waitStageStatus(c.sql, runId, 0, "waiting_review");
  const [t] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
    and kind = 'review' and status = 'open' order by created_at desc limit 1`;
  const res = await c.call("B", "POST", `/review-tasks/${t?.id}/decision`, { result: "pass" });
  expect(res.status).toBe(200);
  await settled(c);
  return runId;
}

describe("AC-H44 · PD2-R05 · lỗi mạng của stage tool side_effect", () => {
  it("AC-H44 · PD2-I06 · cổng đóng (ECONNREFUSED, lỗi trước gửi) ⇒ hẹn retry; dựng fake trên cùng cổng ⇒ bắn hẹn ⇒ 1 lời gọi tới handler, s1 done", async () => {
    await prep();
    const before = net.calls();
    const runId = await runWs();
    expect({
      calls: net.calls() - before,
      timers: (await openTimers(c.sql, runId)).length,
    }).toEqual({
      calls: 0,
      timers: 1,
    });
    expect(await decisionOf(c.sql, runId)).toBeUndefined();
    await net.listen();
    net.modes(["ok"]);
    c.clk.advance(31 * SEC);
    await sweepN(c, 1);
    await settled(c);
    expect(net.calls() - before).toBe(1);
    await waitStageStatus(c.sql, runId, 1, "done", 0);
  }, 30_000);
  for (const mode of ["close_before_body", "close_after_body"] as const) {
    it(`AC-H44 · PD2-I06b · fake nhận kết nối rồi đóng socket (${mode}) ⇒ sent:true ⇒ tool_failed, Dify 1 lần, 0 hẹn retry`, async () => {
      await prep();
      await net.listen();
      net.modes([mode]);
      const before = net.calls();
      const runId = await runWs();
      expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
      expect({
        calls: net.calls() - before,
        timers: (await openTimers(c.sql, runId)).length,
      }).toEqual({
        calls: 1,
        timers: 0,
      });
    }, 30_000);
  }
});
