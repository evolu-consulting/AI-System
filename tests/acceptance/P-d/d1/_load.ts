// HUB-FR-112 · HUB-FR-115 · HUB-FR-145 · helper chèn HÀNG LOẠT run chờ duyệt + task review (PD-P10…P15 · PD-P03;
// plan-addendum A9, A10, CR-093, TECH-DEBT #190). SQL owner, mỗi task một run riêng (`review_tasks_open_uq` = 1 task
// open/stage_run): conversations → flows → process_runs → stage_runs → process_outputs → review_tasks →
// review_task_assignees (Group G1: B, T), mỗi bảng INSERT nhiều hàng (chia lô CHUNK hàng/câu — tránh trần 65 535 tham số).
// Không chứa `it`. Cột 0036 (`remind_every_h`) CHỈ truyền khi gọi sau `needPdSchema` (PD-P03).
import { type CtxPd, DAY, DEFS, G1, type Json, MIN, PA, PA_FIX, type Sql, T } from "../_support/pd";

let seq = 0;
const gen = () => `a5d1f000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

const D = DEFS.hd;
const SNAPSHOT = {
  key: D.key,
  name: D.name,
  stages: D.stages,
  token_budget: null,
  run_group_ids: [],
};
const CHUNK = 500;

async function insertChunked(sql: Sql, table: string, rows: Json[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK)
    await sql`insert into ${sql(table)} ${sql(rows.slice(i, i + CHUNK))}`;
}

type Row = { run: string; conv: string; flow: string; sr: string; out: string; task: string };
type LoadOpts = {
  /** cột 0036 — chỉ sau `needPdSchema`. */
  remindEveryH?: number;
  /** phòng nguồn (`origin_kind=room`) — có thread ⇒ sự kiện `process_thread_events`; vắng ⇒ `admin`. */
  roomId?: string;
  /** mặc định clk + 7 ngày. */
  expiresAt?: Date;
  /** mặc định clk − 1 phút (tới hạn nhắc). */
  remindAt?: Date;
};

async function insertRuns(c: CtxPd, rows: Row[], o: LoadOpts, now: Date): Promise<void> {
  const sql = c.sql;
  const tid = T.acme;
  const by = PA.A.id;
  await insertChunked(
    sql,
    "hub.conversations",
    rows.map((r) => ({
      id: r.conv,
      tenant_id: tid,
      user_id: by,
      title: D.name,
      title_norm: D.name.toLowerCase(),
      process_run_id: r.run,
    })),
  );
  await insertChunked(
    sql,
    "hub.flows",
    rows.map((r) => ({
      id: r.flow,
      tenant_id: tid,
      user_id: by,
      conversation_id: r.conv,
      title: D.name,
      message_count: 1,
    })),
  );
  const snapshot = sql.json(SNAPSHOT as Json);
  await insertChunked(
    sql,
    "hub.process_runs",
    rows.map((r) => ({
      id: r.run,
      tenant_id: tid,
      process_def_id: D.id,
      def_version: 1,
      snapshot,
      started_by: by,
      origin_kind: o.roomId ? "room" : "admin",
      origin_room_id: o.roomId ?? null,
      input: "HD-12 tháng 9",
      conversation_id: r.conv,
      flow_id: r.flow,
      status: "waiting_review",
      current_stage_idx: 0,
      expires_at: o.expiresAt ?? new Date(now.getTime() + 7 * DAY),
      started_at: now,
      updated_at: now,
    })),
  );
}

async function insertTasks(c: CtxPd, rows: Row[], o: LoadOpts, now: Date): Promise<void> {
  const sql = c.sql;
  const tid = T.acme;
  await insertChunked(
    sql,
    "hub.stage_runs",
    rows.map((r) => ({
      id: r.sr,
      tenant_id: tid,
      process_run_id: r.run,
      stage_idx: 0,
      status: "waiting_review",
    })),
  );
  await insertChunked(
    sql,
    "hub.process_outputs",
    rows.map((r) => ({
      id: r.out,
      tenant_id: tid,
      process_run_id: r.run,
      stage_run_id: r.sr,
      stage_idx: 0,
      version: 1,
      attempt: 1,
      content: "## Bảng ý\nHoá đơn HD-12.\n\n## Tổng tiền\n12 000 000",
      template_ok: true,
    })),
  );
  await sql`update hub.stage_runs s set current_output_id = o.id from hub.process_outputs o
    where o.stage_run_id = s.id and s.id = any(${sql.array(
      rows.map((r) => r.sr),
      2950,
    )})`;
  const remindAt = o.remindAt ?? new Date(now.getTime() - MIN);
  await insertChunked(
    sql,
    "hub.review_tasks",
    rows.map((r) => ({
      id: r.task,
      tenant_id: tid,
      process_run_id: r.run,
      stage_run_id: r.sr,
      kind: "review",
      status: "open",
      output_id: r.out,
      assignee_group_id: G1,
      remind_at: remindAt,
      ...(o.remindEveryH === undefined ? {} : { remind_every_h: o.remindEveryH }),
    })),
  );
  await insertChunked(
    sql,
    "hub.review_task_assignees",
    rows.map((r) => ({ tenant_id: tid, task_id: r.task, group_id: G1, via: "initial", depth: 0 })),
  );
}

/** `n` run `waiting_review` (acme, bắt đầu bởi A) + task review open gán G1. */
async function reviewRuns(c: CtxPd, n: number, o: LoadOpts): Promise<Row[]> {
  const now = c.clk.now();
  const rows: Row[] = Array.from({ length: n }, () => ({
    run: gen(),
    conv: gen(),
    flow: gen(),
    sr: gen(),
    out: gen(),
    task: gen(),
  }));
  await insertRuns(c, rows, o, now);
  await insertTasks(c, rows, o, now);
  return rows;
}

/** `n` task review tới hạn nhắc (`remind_at` = clk − 1 phút), run còn hạn 7 ngày. Trả id task. */
export async function dueReviewTasks(
  c: CtxPd,
  n: number,
  o: { remindEveryH?: number } = {},
): Promise<string[]> {
  return (await reviewRuns(c, n, o)).map((r) => r.task);
}

/**
 * `n` run `waiting_review` trong phòng R (A khởi chạy) có task review open, `expires_at` = clk − 1 phút (đã hết hạn),
 * `remind_at` = clk + 1 ngày (vòng nhắc không chạm). Trả `{runIds, taskIds}` cùng thứ tự.
 */
export async function expiringRuns(
  c: CtxPd,
  n: number,
): Promise<{ runIds: string[]; taskIds: string[] }> {
  const now = c.clk.now();
  const rows = await reviewRuns(c, n, {
    roomId: PA_FIX.room,
    expiresAt: new Date(now.getTime() - MIN),
    remindAt: new Date(now.getTime() + DAY),
  });
  return { runIds: rows.map((r) => r.run), taskIds: rows.map((r) => r.task) };
}

/** Đếm trên tập task: đã nhắc (`reminded_at`), notice `reminder`, cặp (task, user) trùng notice. */
export async function remindStats(c: CtxPd, ids: string[]) {
  const arr = c.sql.array(ids, 2950);
  const [a] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.review_tasks
    where id = any(${arr}) and reminded_at is not null`;
  const [b] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_notices
    where kind = 'reminder' and task_id = any(${arr})`;
  const [d] = await c.sql<{ n: number }[]>`select count(*)::int as n from (select task_id, user_id
    from hub.process_notices where kind = 'reminder' and task_id = any(${arr})
    group by task_id, user_id having count(*) > 1) x`;
  return { reminded: a?.n ?? 0, notices: b?.n ?? 0, dupPairs: d?.n ?? 0 };
}

/**
 * Đếm trên tập run hết hạn: run `expired`, task `closed`+`result=expired`, run có ĐÚNG một `run_end`, tổng `run_end`,
 * `run_end` đã đăng (`posted_at` not null — vòng hết hạn không được đăng thread, A10).
 */
export async function expireStats(c: CtxPd, runIds: string[]) {
  const arr = c.sql.array(runIds, 2950);
  const [r] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_runs
    where id = any(${arr}) and status = 'expired'`;
  const [t] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.review_tasks
    where process_run_id = any(${arr}) and status = 'closed' and result = 'expired'`;
  const [e] = await c.sql<{ one: number; total: number; posted: number }[]>`select
      count(*) filter (where n = 1)::int as one, coalesce(sum(n), 0)::int as total,
      coalesce(sum(p), 0)::int as posted
    from (select process_run_id, count(*) as n, count(posted_at) as p from hub.process_thread_events
      where kind = 'run_end' and process_run_id = any(${arr}) group by process_run_id) x`;
  return {
    expired: r?.n ?? 0,
    tasksClosed: t?.n ?? 0,
    runEndOne: e?.one ?? 0,
    runEnd: e?.total ?? 0,
    posted: e?.posted ?? 0,
  };
}
