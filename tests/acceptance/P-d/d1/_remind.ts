// AC-H42 · HUB-FR-145 · HUB-BR-43/25/26 · helper riêng ca nhắc lặp + chuyển cấp (test-plan-int §4). Không chứa `it`.
// Def P-d đi QUA API (`createDef`) — chỉ gọi trong `it` sau `needPdSchema`. Đọc trạng thái bằng owner (`c.sql`).
// Mốc thời gian lấy từ đồng hồ lệch `c.clk` (không từ SQL `now()`).
import { expect } from "bun:test";
import {
  type CtxPd,
  createDef,
  type Json,
  jobDone,
  mdOut,
  nextStageJob,
  openTask,
  PA,
  remind,
  SEC,
  startRun,
  T,
  waitStatus,
} from "../_support/pd";

/** Def `key` đã có (acme, chưa xoá) ⇒ trả hàng; chưa có ⇒ `POST /process-defs` (đòi 201). */
export async function ensureDef(c: CtxPd, body: Json): Promise<Json> {
  const [d] = await c.sql<Json[]>`select id, version from hub.process_defs
    where tenant_id = ${T.acme} and key = ${body.key} and deleted_at is null`;
  return d ?? createDef(c, body);
}

/** Output hợp lệ của `agentStage` (gồm mục "Bàn giao" Hub ép — P-b2; `mdOut()` của `pd.ts`). */
export const MD_PD = mdOut();

export type Gate = { runId: string; task: Json; t0a: number; t0b: number };
/** A start `key` (origin none) ⇒ job s0 xong ⇒ run `waiting_review`, trả task review open + cửa sổ T0 [t0a, t0b]. */
export async function remindGate(c: CtxPd, key = "pd-remind"): Promise<Gate> {
  const t0a = c.clk.now().getTime();
  const runId = await startRun(c, key);
  const job = await nextStageJob(c, runId);
  await jobDone(c, job, MD_PD);
  await waitStatus(c.sql, runId, "waiting_review");
  const task = await openTask(c.sql, runId, "review");
  expect({ reviewTask: task !== undefined }).toEqual({ reviewTask: true });
  return { runId, task: task as Json, t0a, t0b: c.clk.now().getTime() };
}

export async function taskRow(c: CtxPd, id: string): Promise<Json> {
  return (await c.sql<Json[]>`select * from hub.review_tasks where id = ${id}`)[0] as Json;
}
export const ms = (d: Date | string | null | undefined): number =>
  d === null || d === undefined ? Number.NaN : new Date(d).getTime();
/** `v` ∈ [lo, hi] (ms) — trả object để `expect(...).toEqual({ok:true})` in rõ giá trị khi lệch. */
export function within(name: string, v: number, lo: number, hi: number) {
  return { name, ok: v >= lo && v <= hi, v: new Date(v).toISOString() };
}

/** Số notice `kind` của task cho từng người (B, T, H, H2). */
export async function noticeCounts(c: CtxPd, taskId: string, kind = "reminder") {
  const rows = await c.sql<{ user_id: string; n: number }[]>`select user_id, count(*)::int as n
    from hub.process_notices where task_id = ${taskId} and kind = ${kind} group by user_id`;
  const n = (u: { id: string }) => rows.find((r) => r.user_id === u.id)?.n ?? 0;
  return { B: n(PA.B), T: n(PA.T), H: n(PA.H), H2: n(PA.H2) };
}
export const assigneesOf = (c: CtxPd, taskId: string) =>
  c.sql<Json[]>`select tenant_id, user_id, group_id, via, depth from hub.review_task_assignees
    where task_id = ${taskId} order by created_at, id`;
export const auditsOf = (c: CtxPd, taskId: string, action: string) =>
  c.sql<
    Json[]
  >`select actor_id, actor_role, entity, summary, before, after, tenant_id from hub.audit_log
    where entity_id = ${taskId} and action = ${action} order by seq`;

/** Đặt đồng hồ tới `escalate_at` lớn nhất của các task + 1 s rồi `remind` (vòng nhắc chạy chuyển cấp). */
export async function escalateAll(c: CtxPd, gates: Gate[]): Promise<void> {
  const rows = await Promise.all(gates.map((g) => taskRow(c, g.task.id)));
  const at = Math.max(...rows.map((r) => ms(r.escalate_at)));
  expect({ escalateAt: Number.isFinite(at) }).toEqual({ escalateAt: true });
  c.clk.set(new Date(Math.max(at + SEC, c.clk.now().getTime())));
  await remind(c);
}
