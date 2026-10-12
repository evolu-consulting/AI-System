// HUB-FR-118 · PB2-R09 · AC-PB2-08 · plan §7 · test-plan-cases §3.4 `back/race` (RC-01…RC-03): hai người duyệt cùng bước
// đồng thời — quay lại ∥ quay lại (khác/cùng đích), quay lại ∥ Đạt, quay lại ∥ huỷ. First-wins; kẻ thua 409
// `REVIEW_TASK_CLOSED`; run kết thúc không hồi sinh. 10 vòng mỗi ca. DB tag `pb2_back`. 0024 vắng ⇒ đỏ ở `needPb2`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  backEvents,
  type CtxPb2,
  DEFS2,
  finishStages,
  type Json,
  needPb2,
  passStage,
  queuedStages,
  review,
  runRow,
  settleRuns,
  stageRow,
  startInRoom,
  startPb2,
  taskOf,
  waitFor,
  waitStage,
  waitStatus,
} from "../_support/pb2";

let c: CtxPb2;
beforeAll(async () => {
  c = await startPb2();
}, 60_000);
afterAll(() => c?.stop());

const ROUNDS = 10;

/** `pb2-par3` (khác đích) hoặc `pb2-par2` (cùng đích) tới bước có 2 stage cùng `waiting_review`. Trả idx 2 stage. */
async function twoWaiting(kind: "par3" | "par2"): Promise<{ runId: string; a: number; b: number }> {
  const s = await startInRoom(c, { key: DEFS2[kind].key });
  if (kind === "par3") {
    await finishStages(c, s.runId, [0, 1]);
    await finishStages(c, s.runId, [2, 3]);
    await waitStage(c.sql, s.runId, 2, "waiting_review");
    await waitStage(c.sql, s.runId, 3, "waiting_review");
    return { runId: s.runId, a: 2, b: 3 };
  }
  await finishStages(c, s.runId, [0]);
  await passStage(c, s.runId, 0, "B");
  await finishStages(c, s.runId, [1, 2]);
  await waitStage(c.sql, s.runId, 1, "waiting_review");
  await waitStage(c.sql, s.runId, 2, "waiting_review");
  return { runId: s.runId, a: 1, b: 2 };
}

describe("RC · hai người cùng quay lại [AC-PB2-08][PB2-R09]", () => {
  it("AC-PB2-08 · RC-01 · B quay lại ∥ T quay lại (pb2-par3 khác đích, pb2-par2 cùng đích) ⇒ 1×200 + 1×409 REVIEW_TASK_CLOSED; 1 event; back_rounds 1 (10 vòng)", async () => {
    needPb2(c.pb2);
    for (let k = 0; k < ROUNDS; k++) {
      const kind = k % 2 === 0 ? "par3" : "par2";
      const g = await twoWaiting(kind);
      const ta = await taskOf(c.sql, g.runId, g.a);
      const tb = await taskOf(c.sql, g.runId, g.b);
      const toA = 0;
      const toB = kind === "par3" ? 1 : 0;
      const [ra, rb] = await Promise.all([
        review(c, "B", ta?.id, { result: "fail", feedback: "B quay lại", back_to_step: toA }),
        review(c, "T", tb?.id, { result: "fail", feedback: "T quay lại", back_to_step: toB }),
      ]);
      const res = [ra, rb].map((r) => ({ s: r.status, code: r.json?.error?.code ?? null }));
      expect({ k, res: [...res].sort((x, y) => x.s - y.s) }).toEqual({
        k,
        res: [
          { s: 200, code: null },
          { s: 409, code: "REVIEW_TASK_CLOSED" },
        ],
      });
      const loser = ra.status === 409 ? ta?.id : tb?.id;
      const [lt] = await c.sql<
        Json[]
      >`select status, result from hub.review_tasks where id = ${loser}`;
      expect({ k, lt }).toEqual({ k, lt: { status: "closed", result: "superseded" } });
      const evs = await backEvents(c.sql, g.runId);
      const run = await runRow(c.sql, g.runId);
      const winnerTo = ra.status === 200 ? toA : toB;
      expect({ k, n: evs.length, rounds: run.back_rounds, step: run.current_step }).toEqual({
        k,
        n: 1,
        rounds: 1,
        step: winnerTo,
      });
      await settleRuns(c.sql);
    }
  }, 600_000);
  it("AC-PB2-08 · RC-02 · quay lại (P1a) ∥ Đạt (P1b) ⇒ quay lại luôn 200; Đạt 409 nếu thua, nếu thắng thì P1b bị reset round 2 (10 vòng)", async () => {
    needPb2(c.pb2);
    for (let k = 0; k < ROUNDS; k++) {
      const g = await twoWaiting("par2");
      const ta = await taskOf(c.sql, g.runId, 1);
      const tb = await taskOf(c.sql, g.runId, 2);
      const [back, pass] = await Promise.all([
        review(c, "B", ta?.id, { result: "fail", feedback: "Về P0", back_to_step: 0 }),
        review(c, "T", tb?.id, { result: "pass" }),
      ]);
      expect({ k, back: back.status }).toEqual({ k, back: 200 });
      if (pass.status === 200)
        expect({ k, round: (await stageRow(c.sql, g.runId, 2)).round }).toEqual({ k, round: 2 });
      else
        expect({ k, pass: pass.status, code: pass.json?.error?.code }).toEqual({
          k,
          pass: 409,
          code: "REVIEW_TASK_CLOSED",
        });
      expect({ k, n: (await backEvents(c.sql, g.runId)).length }).toEqual({ k, n: 1 });
      await settleRuns(c.sql);
    }
  }, 600_000);
  it("HUB-FR-111 · RC-03 · quay lại ∥ huỷ run ⇒ cuối cùng cancelled, không hồi sinh, không job queued mới (10 vòng)", async () => {
    needPb2(c.pb2);
    for (let k = 0; k < ROUNDS; k++) {
      const g = await twoWaiting("par2");
      const ta = await taskOf(c.sql, g.runId, 1);
      await Promise.all([
        review(c, "B", ta?.id, { result: "fail", feedback: "Về P0", back_to_step: 0 }),
        c.call("A", "POST", `/process-runs/${g.runId}/cancel`, {}),
      ]);
      await waitStatus(c.sql, g.runId, "cancelled");
      // hồi sinh = trạng thái rời `cancelled` trong 1,5 s (chờ theo điều kiện, hết hạn ⇒ trả giá trị cuối)
      const after = await waitFor(
        () => runRow(c.sql, g.runId),
        (v) => v?.status !== "cancelled",
        1_500,
      );
      expect({ k, status: after.status, queued: await queuedStages(c.sql, g.runId) }).toEqual({
        k,
        status: "cancelled",
        queued: [],
      });
      await settleRuns(c.sql);
    }
  }, 600_000);
});
