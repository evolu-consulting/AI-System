// HUB-FR-107 · plan §10 (thứ tự khoá) · §3.4 · P1-48…P1-50 (test-plan-int §2): decision ∥ cancel ∥ expire (`sweepOnce`) cùng
// run ×20 không deadlock (`40P01`) / timeout, trạng thái cuối nhất quán; decision trên task ask ⇒ 409; task đóng / không
// assignee / tenant khác. Run SQL fixture (`insertRun`…), `expires_at` quá khứ qua `startedAt` (ca ghi rõ, P1-73 cùng cách).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  insertOutput,
  insertRun,
  insertTask,
  type Json,
  PA,
  PA_FIX,
  type Res,
  type Sql,
} from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  type CtxPf1,
  DEFS,
  jobDone,
  nextStageJob,
  review,
  runRow,
  startInRoom,
  startPf1,
  sweep,
} from "./_local";

let c: CtxPf1;
beforeAll(async () => {
  c = await startPf1();
  if (!c.ready) return;
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const code = (r: { json: Json }) => r.json?.error?.code;
const TERMINAL = ["done", "cancelled", "failed", "expired"];

async function endHubRuns(sql: Sql, processRunId: string): Promise<void> {
  await sql`update hub.jobs set status = 'succeeded', finished_at = now()
    where run_id in (select id from hub.runs where process_run_id = ${processRunId}) and status in ('queued','running')`;
  await sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where process_run_id = ${processRunId} and status = 'running'`;
}

/** Run gate 1 (waiting_review, task review group Kế toán); `expired` ⇒ `expires_at` đã qua (bắt đầu 8 ngày trước). */
async function gateFix(o: { expired?: boolean } = {}) {
  const run = await insertRun(c.sql, {
    def: DEFS.hd,
    startedBy: PA.A,
    roomId: PA_FIX.room,
    status: "waiting_review",
    startedAt: o.expired ? new Date(Date.now() - 8 * 86_400_000) : undefined,
  });
  const s0 = run.stageRunIds[0] as string;
  const outputId = await insertOutput(c.sql, {
    tid: PA.A.tid,
    runId: run.runId,
    stageRunId: s0,
    stageIdx: 0,
  });
  await c.sql`update hub.stage_runs set current_output_id = ${outputId} where id = ${s0}`;
  const taskId = await insertTask(c.sql, {
    tid: PA.A.tid,
    runId: run.runId,
    stageRunId: s0,
    kind: "review",
    outputId,
    groupId: PA_FIX.gKeToan,
  });
  return { ...run, taskId };
}

/** Phản hồi API trong vòng đua: 200 hoặc 409 đúng mã; không 5xx / 40P01. */
function checkReplies(i: number, d: Res | null, cx: Res | null): void {
  expect({ round: i, d: !!d && [200, 409].includes(d.status) }).toEqual({ round: i, d: true });
  expect({ round: i, c: !!cx && [200, 409].includes(cx.status) }).toEqual({ round: i, c: true });
  if (d?.status === 409) expect(["REVIEW_TASK_CLOSED", "PROCESS_RUN_STATE"]).toContain(code(d));
  if (cx?.status === 409) expect(code(cx)).toBe("PROCESS_RUN_STATE");
  expect(`${d?.text ?? ""}${cx?.text ?? ""}`).not.toContain("40P01");
}

/** Trạng thái cuối nhất quán: kết thúc, 0 task open, đúng một nhánh thắng, đúng 1 `run_end`. */
async function checkFinal(i: number, g: { runId: string; stageRunIds: string[] }): Promise<void> {
  const run = await runRow(c.sql, g.runId);
  expect({ round: i, terminal: TERMINAL.includes(run.status) }).toEqual({
    round: i,
    terminal: true,
  });
  expect(run.finished_at).not.toBeNull();
  const [open] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.review_tasks
    where process_run_id = ${g.runId} and status = 'open'`;
  expect({ round: i, open: open?.n }).toEqual({ round: i, open: 0 });
  const [s0] = await c.sql<Json[]>`select status, passed_by from hub.stage_runs
    where id = ${g.stageRunIds[0] as string}`;
  // Đạt thắng (stage done, passed_by B) xor huỷ/hết hạn trước (stage không done, passed_by null)
  expect({ round: i, passed_by: s0?.passed_by ?? null }).toEqual({
    round: i,
    passed_by: s0?.status === "done" ? PA.B.id : null,
  });
  const [ends] = await c.sql<
    { n: number }[]
  >`select count(*)::int as n from hub.process_thread_events
    where process_run_id = ${g.runId} and kind = 'run_end'`;
  expect({ round: i, runEnd: ends?.n }).toEqual({ round: i, runEnd: 1 });
}

describe("P1-48 · decision ∥ cancel ∥ expire [§10]", () => {
  it("HUB-FR-107 · P1-48 · ×20: B Đạt ∥ A huỷ ∥ sweepOnce (hết hạn) ⇒ không 40P01/timeout/5xx; trạng thái cuối nhất quán", async () => {
    needSchema(c.ready);
    for (let i = 0; i < 20; i++) {
      const g = await gateFix({ expired: true });
      const t0 = Date.now();
      const [rd, rc, sw] = await Promise.allSettled([
        review(c, "B", g.taskId, { result: "pass" }),
        c.call("A", "POST", `/process-runs/${g.runId}/cancel`, {}),
        sweep(c),
      ]);
      expect({ round: i, sweep: sw.status }).toEqual({ round: i, sweep: "fulfilled" });
      expect(Date.now() - t0).toBeLessThan(15_000);
      checkReplies(
        i,
        rd.status === "fulfilled" ? rd.value : null,
        rc.status === "fulfilled" ? rc.value : null,
      );
      // sweep lần 2: nếu Đạt thắng trước, run chạy stage 2 với expires_at đã qua ⇒ hết hạn.
      await sweep(c);
      await checkFinal(i, g);
      await endHubRuns(c.sql, g.runId);
    }
  }, 180_000);
});

/**
 * TS1 · #234 — `jobDone` chỉ XADD kết quả job vào Redis; Hub xử lý (apply) bất đồng bộ. Sweep lần 2 chạy ngay sau vòng đua có thể
 * TRƯỚC apply (máy tải) ⇒ run chưa tới `waiting_review` nên chưa hết hạn ⇒ ca đỏ oan ("expired" ≠ "waiting_review"). Chờ TÍN HIỆU
 * trạng thái (run đã kết thúc, hoặc không còn stage `running`: apply đã chuyển stage) rồi mới sweep lần 2; không chờ mốc giờ,
 * 15 s chỉ là lưới an toàn khi engine treo.
 */
async function settleApply(runId: string): Promise<void> {
  const end = Date.now() + 15_000;
  for (;;) {
    const [r] = await c.sql<
      { done: boolean }[]
    >`select (pr.status in ('done','cancelled','failed','expired')
        or not exists (select 1 from hub.stage_runs s where s.process_run_id = pr.id and s.status = 'running')) as done
      from hub.process_runs pr where pr.id = ${runId}`;
    if (r?.done) return;
    if (Date.now() > end) throw new Error(`apply chưa xong sau 15 s: ${runId}`);
    await Bun.sleep(10);
  }
}

/** Vòng đua: stage đang chạy (job đã claim), `finish` (apply) ∥ `rival` (huỷ / sweep); thứ tự phát xen kẽ theo i. */
async function raceApply(i: number, rival: (runId: string) => Promise<unknown>, expired: boolean) {
  const s = await startInRoom(c);
  const job = await nextStageJob(c, s.runId);
  if (expired) {
    await c.sql`update hub.process_runs set expires_at = now() - interval '1 hour' where id = ${s.runId}`;
  }
  const finish = () => jobDone(c, job);
  const t0 = Date.now();
  const order = i % 2 === 0 ? [finish, rival] : [rival, finish];
  const started = order.map(async (fn, k) => {
    // xen kẽ: 0..2 lượt nhường event loop theo i để quét các điểm cắt khác nhau
    for (let y = 0; y < (Math.floor(i / 2) + k) % 3; y++) await Promise.resolve();
    return fn(s.runId);
  });
  const res = await Promise.allSettled(started);
  expect(Date.now() - t0).toBeLessThan(15_000);
  await settleApply(s.runId);
  const txt = res.map((r) =>
    r.status === "fulfilled" ? JSON.stringify(r.value ?? "") : String(r.reason),
  );
  expect({ round: i, deadlock: txt.join("").includes("40P01") }).toEqual({
    round: i,
    deadlock: false,
  });
  return { runId: s.runId, res };
}

/** Run đã kết thúc không bị hồi sinh: 0 task open, đúng 1 `run_end`, stage không treo `running`/`waiting_review`. */
async function checkNotRevived(i: number, runId: string, want: string): Promise<void> {
  const run = await runRow(c.sql, runId);
  expect({ round: i, status: run.status }).toEqual({ round: i, status: want });
  expect(run.finished_at).not.toBeNull();
  const [open] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.review_tasks
    where process_run_id = ${runId} and status = 'open'`;
  expect({ round: i, open: open?.n }).toEqual({ round: i, open: 0 });
  const [ends] = await c.sql<
    { n: number }[]
  >`select count(*)::int as n from hub.process_thread_events
    where process_run_id = ${runId} and kind = 'run_end'`;
  expect({ round: i, runEnd: ends?.n }).toEqual({ round: i, runEnd: 1 });
  const [live] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.stage_runs
    where process_run_id = ${runId} and status in ('running','waiting_review')`;
  expect({ round: i, liveStage: live?.n }).toEqual({ round: i, liveStage: 0 });
  await endHubRuns(c.sql, runId);
}

describe("P1-48d…P1-48e · apply (stage-driver) ∥ cancel / expire [§10 · Major #1]", () => {
  it("HUB-FR-106 · HUB-FR-107 · P1-48d · ×20: job stage xong (apply) ∥ A huỷ ⇒ cancelled không bị hồi sinh; không task/sự kiện mồ côi; không 40P01", async () => {
    needSchema(c.ready);
    for (let i = 0; i < 20; i++) {
      let cancelRes: Res | null = null;
      const r = await raceApply(
        i,
        async (runId) => {
          cancelRes = await c.call("A", "POST", `/process-runs/${runId}/cancel`, {});
          return cancelRes;
        },
        false,
      );
      const cx = cancelRes as Res | null;
      expect({ round: i, cancel: !!cx && [200, 409].includes(cx.status) }).toEqual({
        round: i,
        cancel: true,
      });
      if (cx?.status === 409) expect(code(cx)).toBe("PROCESS_RUN_STATE");
      // huỷ 200 đã commit ⇒ apply thua phải no-op: cuối cùng vẫn cancelled (sweep không đổi được)
      await sweep(c);
      if (cx?.status === 200) await checkNotRevived(i, r.runId, "cancelled");
      else expect(TERMINAL).toContain((await runRow(c.sql, r.runId)).status);
    }
  }, 240_000);

  it("HUB-FR-106 · HUB-FR-107 · P1-48e · ×20: job stage xong (apply) ∥ sweepOnce (hết hạn) ⇒ cuối cùng expired, không hồi sinh; không 40P01", async () => {
    needSchema(c.ready);
    for (let i = 0; i < 20; i++) {
      const r = await raceApply(i, () => sweep(c), true);
      // apply thắng trước ⇒ run chờ duyệt với expires_at đã qua ⇒ sweep kế hết hạn; sweep thắng ⇒ giữ expired
      await sweep(c);
      await checkNotRevived(i, r.runId, "expired");
    }
  }, 240_000);
});

describe("P1-49…P1-50 · task sai loại / đã đóng / không assignee [§3.4 · §3]", () => {
  it("HUB-FR-107 · P1-49 · `decision` trên task ask ⇒ 409 TASK_KIND_MISMATCH", async () => {
    needSchema(c.ready);
    const run = await insertRun(c.sql, {
      def: DEFS.hd,
      startedBy: PA.A,
      roomId: PA_FIX.room,
      status: "waiting_answer",
    });
    const taskId = await insertTask(c.sql, {
      tid: PA.A.tid,
      runId: run.runId,
      stageRunId: run.stageRunIds[0] as string,
      kind: "ask",
      userIds: [PA.A.id],
    });
    const r = await review(c, "A", taskId, { result: "pass" });
    expect({ status: r.status, code: code(r) }).toEqual({
      status: 409,
      code: "TASK_KIND_MISMATCH",
    });
    const [t] = await c.sql<Json[]>`select status from hub.review_tasks where id = ${taskId}`;
    expect(t?.status).toBe("open");
  }, 30_000);

  it("HUB-FR-107 · P1-50 · task đã đóng ⇒ 409 REVIEW_TASK_CLOSED; X (không assignee) ⇒ 404; D (tenant khác) ⇒ 404", async () => {
    needSchema(c.ready);
    const g = await gateFix();
    const rx = await review(c, "X", g.taskId, { result: "pass" });
    expect(rx.status).toBe(404);
    const rd = await review(c, "D", g.taskId, { result: "pass" });
    expect(rd.status).toBe(404);
    expect(rd.text).not.toContain(g.runId);
    await c.sql`update hub.review_tasks set status = 'closed', result = 'pass', decided_by = ${PA.T.id},
      decided_at = now() where id = ${g.taskId}`;
    const rb = await review(c, "B", g.taskId, { result: "pass" });
    expect({ status: rb.status, code: code(rb) }).toEqual({
      status: 409,
      code: "REVIEW_TASK_CLOSED",
    });
    expect((await runRow(c.sql, g.runId)).status).toBe("waiting_review");
  }, 30_000);
});
