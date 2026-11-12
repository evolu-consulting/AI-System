// CR-127 · E10 · spec §5.9 · int (DB thật, role `hub_api`): việc nhóm «Xác nhận mốc» — mở task `kind='milestone'` + `subject_ref`, giao #60
// (phòng đầu tiên của người phụ trách / đích danh khi không phòng), nhận / trả về như Duyệt, tín hiệu gói đóng task đúng MỘT lần, và ghi
// tín hiệu (tx gói chưa commit) ∥ nhận việc không chờ khoá nhau (không deadlock — #54).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import type { ProcessDeps } from "../core/ports";
import { ClaimService } from "../gates/claim.service";
import { type ClaimWorld, claimWorld } from "../testing/claim-seed";
import { MILESTONE_TASK_EVENT, openMilestoneTask, taskSignalBatch } from "./milestone-task.repo";

let o: Sql;
let db: Db;
let w: ClaimWorld;
const T0 = new Date("2026-11-10T08:00:00.000Z");
const SNAP = {
  key: "ms",
  name: "Xác nhận mốc",
  token_budget: null,
  run_group_ids: [],
  stages: [
    {
      key: "xn",
      name: "Xác nhận mốc",
      step: 0,
      after: { kind: "auto" },
      executor: { kind: "wait_event", event: MILESTONE_TASK_EVENT, timeout_h: 2160 },
    },
  ],
};
const deps = () =>
  ({
    db,
    config: {
      user: async (uid: string) => ({ active: true, groupIds: new Set(w.groupsOf.get(uid) ?? []) }),
    },
    now: () => T0,
    log: { warn: () => {}, info: () => {}, error: () => {} },
  }) as unknown as ProcessDeps;
const who = (userId: string) => ({ userId, tenantId: w.T, role: "member" }) as never;

/** Lượt `milestone.due` của mốc `ref` (người bắt đầu = người phụ trách) + stage đang chờ; mở việc như launcher.
 *  `after` = cấu hình node (E10a: Ai làm / Cần / Quá hạn chuyển cho / Nhắc — như khối Duyệt); vắng ⇒ mặc định #60. */
async function milestoneRun(owner: string, after?: Record<string, unknown>) {
  const snap = after ? { ...SNAP, stages: [{ ...SNAP.stages[0], after }] } : SNAP;
  const ref = crypto.randomUUID();
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${w.T}, ${owner}, 'c', 'c') returning id::text as id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, current_step, current_stage_idx, status, pack_key, pack_record_id)
    values (${w.T}, ${w.defId}, 1, ${o.json(snap as never)}, ${owner}, 'admin', 'x', ${c?.id as string}, gen_random_uuid(), 0, 0, 'running',
      'contracts', ${ref}) returning id::text as id`;
  const runId = r?.id as string;
  const [s] = await o<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
    values (${w.T}, ${runId}, 0, 'waiting_timer') returning id::text as id`;
  const stageRunId = s?.id as string;
  const open = () =>
    withHubScope(db, { kind: "system" }, (tx) =>
      openMilestoneTask(tx, { tenantId: w.T, runId, stageRunId, now: T0 }),
    );
  const taskId = (await open()) as string;
  return { ref, runId, taskId, open };
}
const timingRow = async (id: string) =>
  (
    await o<
      {
        every: number | null;
        esc_at: Date | null;
        esc_user: string | null;
        esc_group: string | null;
      }[]
    >`
    select remind_every_h as every, escalate_at as esc_at, escalate_user_id::text as esc_user,
      escalate_group_id::text as esc_group from hub.review_tasks where id = ${id}`
  )[0];
const taskRow = async (id: string) =>
  (
    await o<
      {
        kind: string;
        subject_ref: string;
        status: string;
        group_id: string | null;
        users: string[];
      }[]
    >`
    select t.kind, t.subject_ref, t.status, t.assignee_group_id::text as group_id,
      coalesce((select array_agg(a.user_id::text) from hub.review_task_assignees a
        where a.task_id = t.id and a.user_id is not null), '{}') as users
    from hub.review_tasks t where t.id = ${id}`
  )[0];
/** Gói ghi tín hiệu trong tx của chính nó (scope user của tenant). */
const signal = (ref: string, result = "done") =>
  withHubScope(db, { kind: "user", userId: w.A, tenantId: w.T }, (tx) =>
    tx.execute(`select hub.task_signal('milestone', '${ref}', '${result}')` as never),
  );

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(3);
  w = await claimWorld(o, 1272);
  db = connectDb(urls().hubApi, 6);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 E10 · Xác nhận mốc là việc nhóm", () => {
  it("mở task milestone + subject_ref; owner nhiều phòng ⇒ phòng đầu tiên; mở lại không thêm task", async () => {
    const m = await milestoneRun(w.A);
    expect(await taskRow(m.taskId)).toEqual({
      kind: "milestone",
      subject_ref: m.ref,
      status: "open",
      group_id: w.G,
      users: [],
    });
    expect(await m.open()).toBe(m.taskId);
  });

  it("owner không thuộc phòng nào ⇒ giao đích danh owner", async () => {
    const m = await milestoneRun(w.X);
    const t = await taskRow(m.taskId);
    expect([t?.group_id, t?.users]).toEqual([null, [w.X]]);
  });

  it("E10a · cấu hình node: phòng chọn thắng phòng người phụ trách; nhắc + quá hạn chuyển cho chép vào task", async () => {
    const m = await milestoneRun(w.A, {
      kind: "review",
      group_id: w.G0,
      remind_every_h: 4,
      escalate: { after_h: 48, user_id: w.TA },
    });
    const t = await taskRow(m.taskId);
    expect([t?.group_id, t?.users]).toEqual([w.G0, []]);
    const tm = await timingRow(m.taskId);
    expect(tm?.every).toBe(4);
    expect(tm?.esc_at?.toISOString()).toBe(new Date(T0.getTime() + 48 * 3_600_000).toISOString());
    expect([tm?.esc_user, tm?.esc_group]).toEqual([w.TA, null]);
  });

  it("E10a · Cần: trưởng phòng ⇒ giao đích danh trưởng phòng (phòng mặc định của người phụ trách)", async () => {
    const m = await milestoneRun(w.A, { kind: "review", group_id: null, need: "head" });
    const t = await taskRow(m.taskId);
    expect([t?.group_id, t?.users]).toEqual([null, [w.H]]);
  });

  it("E10a · Cần: trưởng phòng mà phòng không có trưởng ⇒ cả phòng nhận việc", async () => {
    const m = await milestoneRun(w.A, { kind: "review", group_id: w.G0, head_only: true });
    const t = await taskRow(m.taskId);
    expect([t?.group_id, t?.users]).toEqual([w.G0, []]);
  });

  it("E10a · Ai làm: người cụ thể ⇒ giao đích danh người đó", async () => {
    const m = await milestoneRun(w.A, { kind: "review", group_id: null, approver_user_id: w.X });
    const t = await taskRow(m.taskId);
    expect([t?.group_id, t?.users]).toEqual([null, [w.X]]);
  });

  it("nhận việc / trả về như Duyệt", async () => {
    const m = await milestoneRun(w.A);
    const c = new ClaimService(deps());
    expect((await c.claim(who(w.B), m.taskId)).claim.state).toBe("mine");
    expect((await c.release(who(w.B), m.taskId)).claim.state).toBe("unclaimed");
    expect((await c.claim(who(w.A), m.taskId)).claim.by?.id).toBe(w.A);
  });

  it("tín hiệu đóng task đúng một lần (ghi lặp + chạy vòng lặp vô hại)", async () => {
    const m = await milestoneRun(w.A);
    await signal(m.ref);
    await signal(m.ref);
    const [n] = await o<{ n: number }[]>`select count(*)::int as n from hub.task_signals
      where subject_ref = ${m.ref} and processed_at is null`;
    expect(n?.n).toBe(1);
    await taskSignalBatch(db, T0);
    await taskSignalBatch(db, T0);
    expect((await taskRow(m.taskId))?.status).toBe("closed");
    const [p] = await o<{ n: number }[]>`select count(*)::int as n from hub.task_signals
      where subject_ref = ${m.ref} and processed_at is not null`;
    expect(p?.n).toBe(1);
  });

  it("ghi tín hiệu (tx gói đang mở) ∥ nhận việc ⇒ không chờ nhau, không deadlock", async () => {
    const m = await milestoneRun(w.A);
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const pack = withHubScope(db, { kind: "user", userId: w.A, tenantId: w.T }, async (tx) => {
      await tx.execute(`select hub.task_signal('milestone', '${m.ref}', 'done')` as never);
      await hold; // tx gói chưa commit trong khi người khác nhận việc
    });
    const claimed = await new ClaimService(deps()).claim(who(w.B), m.taskId);
    expect(claimed.claim.state).toBe("mine");
    release();
    await pack;
    await taskSignalBatch(db, T0);
    expect((await taskRow(m.taskId))?.status).toBe("closed");
  });
});
