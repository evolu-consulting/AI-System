// Spike ADR-0017 · engine chạy bền (docs/platform/spike-engine.md). KHÔNG thuộc acceptance/CI: chạy tay
//   bun --env-file=.env.local --config=bunfig.int.toml test --timeout 120000 spikes/engine/engine.spike.test.ts
// Mỗi `it` khẳng định HÀNH VI MONG MUỐN cho flow nghiệp vụ dài ngày; đỏ = khoảng trống của engine hiện tại (ghi vào ADR).
// Dùng hạ tầng P-a/PF1 có sẵn: hub-api thật in-process, `processLoops:false`, đồng hồ giả `now`, runtime giả claim job.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ProcessStageDefSchema } from "../../packages/contracts/src/hub-admin/processes";
import { cm, type Json, PA, PA_FIX } from "../../tests/acceptance/P-a/_support/pa";
import {
  type CtxPf1,
  DEFS,
  handles,
  jobDone,
  jobFail,
  MD_OK,
  nextStageJob,
  outputs,
  review,
  runRow,
  secondHub,
  stageRow,
  startInRoom,
  startPf1,
  toGate,
  waitStatus,
} from "../../tests/acceptance/P-a/pf1/_local";
import { reviewRun } from "../../tests/acceptance/P-a/pf3/_local";

const H = 3_600_000;
let clock = Date.now();
const now = () => new Date(clock);
let c: CtxPf1;

beforeAll(async () => {
  c = await startPf1({ now });
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

/** Dọn run còn chạy để giới hạn 5 run/tenant không chặn bài sau. */
async function settle(): Promise<void> {
  await c.sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status in ('running','waiting_review','waiting_answer','needs_decision')`;
  await c.sql`update hub.jobs set status = 'cancelled', finished_at = now() where status in ('queued','running')`;
  await c.sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where status = 'running'`;
}

describe("Spike engine — 6 bài thử lỗi", () => {
  it("1 · Sập giữa bước: job lỗi ⇒ stage tự chạy lại, đúng MỘT output", async () => {
    await settle();
    const s = await startInRoom(c);
    const j1 = await nextStageJob(c, s.runId);
    await jobFail(c, j1, "INTERNAL_ERROR");
    await handles(c).sweepOnce();
    await Bun.sleep(1_500);
    const r1 = await runRow(c.sql, s.runId);
    const s1 = await stageRow(c.sql, s.runId, 0);
    console.log(
      JSON.stringify({ spike1: { run: r1.status, stage: s1.status, attempt: s1.attempt } }),
    );
    const j2 = await nextStageJob(c, s.runId, 10_000);
    await jobDone(c, j2, MD_OK);
    await waitStatus(c.sql, s.runId, "waiting_review");
    const outs = await outputs(c.sql, s.runId);
    expect(outs.length).toBe(1);
    const st = await stageRow(c.sql, s.runId, 0);
    expect(Number(st.attempt)).toBe(2);
  }, 60_000);

  it("2 · Chạy trùng: cùng client_msg_id gửi 2 lần ⇒ chỉ MỘT process_run", async () => {
    await settle();
    const id = cm();
    const body = { client_msg_id: id, content: "!hoa-don-t HD-DUP" };
    const a = await c.call("A", "POST", `/rooms/${PA_FIX.room}/messages`, body);
    const b = await c.call("A", "POST", `/rooms/${PA_FIX.room}/messages`, body);
    const [n] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_runs
      where input = 'HD-DUP'`;
    expect({ first: a.status, second: b.status, runs: n?.n }).toMatchObject({
      first: 201,
      runs: 1,
    });
  }, 60_000);

  it("3a · Hẹn giờ qua restart: nhắc task vẫn bắn đúng một lần sau khi Hub khởi động lại", async () => {
    await settle();
    clock = Date.now();
    const g = await toGate(c);
    // "Khởi động lại" = một tiến trình Hub mới, không giữ gì trong bộ nhớ, chỉ đọc DB (Hub cũ để nguyên cho bài sau).
    const hub2 = await secondHub(c, { now });
    try {
      const h2 = hub2.handles() as Json;
      clock += 25 * H;
      expect(await h2.remindOnce()).toBeGreaterThanOrEqual(1);
      await h2.remindOnce();
      const [t] = await c.sql<
        Json[]
      >`select reminded_at from hub.review_tasks where id = ${g.taskId}`;
      expect(t?.reminded_at).not.toBeNull();
      const rows = await c.sql<Json[]>`select id from hub.process_notices
        where task_id = ${g.taskId} and kind = 'reminder' and user_id = ${PA.B.id}`;
      expect(rows.length).toBe(1);
    } finally {
      await hub2.stop();
    }
  }, 90_000);

  it("3b · Chờ đến ngày: định nghĩa flow có loại bước hẹn ngày / gọi tool / rẽ nhánh", () => {
    const base = ProcessStageDefSchema.parse(DEFS.hd.stages[0]);
    const kinds = ["wait_until", "tool", "condition"].map((kind) => ({
      kind,
      ok: ProcessStageDefSchema.safeParse({ ...base, executor: { kind } }).success,
    }));
    expect(kinds).toEqual([
      { kind: "wait_until", ok: true },
      { kind: "tool", ok: true },
      { kind: "condition", ok: true },
    ]);
  });

  it("4 · Quá hạn: task vẫn mở sau lần nhắc đầu ⇒ nhắc lại / chuyển cấp", async () => {
    await settle();
    clock = Date.now();
    const g = await toGate(c);
    const h = handles(c);
    clock += 25 * H;
    await h.remindOnce();
    clock += 48 * H;
    const again = await h.remindOnce();
    const rows = await c.sql<Json[]>`select id from hub.process_notices
      where task_id = ${g.taskId} and kind = 'reminder' and user_id = ${PA.B.id}`;
    expect({ again, reminders: rows.length }).toEqual({ again: 1, reminders: 2 });
  }, 90_000);

  it("4b · Dài ngày: run chờ duyệt quá 7 ngày KHÔNG bị expired (flow hợp đồng sống nhiều tháng)", async () => {
    await settle();
    clock = Date.now();
    const g = await toGate(c);
    clock += 8 * 24 * H;
    await handles(c).sweepOnce();
    const r = await runRow(c.sql, g.runId);
    expect(r.status).toBe("waiting_review");
  }, 90_000);

  it("5 · Đổi version: sửa template khi run đang chạy ⇒ run giữ snapshot cũ, chạy tiếp đúng bản cũ", async () => {
    await settle();
    clock = Date.now();
    const g = await toGate(c);
    await c.sql`update hub.process_defs set version = 2,
        stages = ${c.sql.json([DEFS.hd.stages[0]] as Json[])}
      where id = ${DEFS.hd.id}`;
    expect((await review(c, "B", g.taskId, { result: "pass" })).status).toBe(200);
    const j = await nextStageJob(c, g.runId, 10_000);
    await jobDone(c, j, "## Kết quả\nĐã ghi sổ.");
    await waitStatus(c.sql, g.runId, "done", 15_000);
    const r = await runRow(c.sql, g.runId);
    expect({ def_version: r.def_version, stages: r.snapshot?.stages?.length }).toEqual({
      def_version: 1,
      stages: 2,
    });
    await c.sql`update hub.process_defs set version = 1, stages = ${c.sql.json(DEFS.hd.stages as Json[])}
      where id = ${DEFS.hd.id}`;
  }, 90_000);

  it("6 · Tải: 1.000 task chờ duyệt ⇒ nhắc hết, mỗi lượt quét nhanh", async () => {
    await settle();
    clock = Date.now();
    const N = 1_000;
    const t0 = performance.now();
    // Mỗi task một run/stage riêng (unique review_tasks_open_uq), qua fixture P-a (run waiting_review + output + task).
    for (let i = 0; i < N; i += 25) {
      await Promise.all(Array.from({ length: Math.min(25, N - i) }, () => reviewRun(c)));
    }
    await c.sql`update hub.review_tasks set remind_at = ${new Date(clock - H)} where status = 'open'
      and reminded_at is null`;
    const seedMs = performance.now() - t0;
    const h = handles(c);
    let total = 0;
    let rounds = 0;
    const roundMs: number[] = [];
    for (;;) {
      const a = performance.now();
      const n = await h.remindOnce();
      roundMs.push(performance.now() - a);
      rounds++;
      total += n;
      if (n === 0 || rounds > 50) break;
    }
    const s = performance.now();
    await h.sweepOnce();
    const sweepMs = performance.now() - s;
    const p95 = [...roundMs].sort((x, y) => x - y)[Math.floor(roundMs.length * 0.95)] ?? 0;
    console.log(JSON.stringify({ spike6: { N, seedMs, total, rounds, p95RoundMs: p95, sweepMs } }));
    expect(total).toBeGreaterThanOrEqual(N);
    expect(p95).toBeLessThan(2_000);
  }, 180_000);
});
