// CR-127 · E10 · adapter Postgres của `FlowTaskSignal`: gọi definer `hub.task_signal` / `hub.task_holder` (0131) trong tx của gói.
import { sql } from "drizzle-orm";
import type { FlowTaskHolder, FlowTaskSignal } from "../application/task-signal.ports";

type SqlTx = { execute: <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => Promise<T[]> };

const rowsOf = <T>(r: unknown): T[] =>
  Array.isArray(r) ? (r as T[]) : (((r as { rows?: T[] }).rows ?? []) as T[]);

export const pgFlowTaskSignal: FlowTaskSignal<SqlTx> = {
  async complete(tx, s, result) {
    const r = await tx.execute<{ id: string | null }>(
      sql`select hub.task_signal(${s.kind}, ${s.subjectRef}, ${result})::text as id`,
    );
    return rowsOf<{ id: string | null }>(r)[0]?.id ?? null;
  },
  async holder(tx, s) {
    const r = await tx.execute<{
      task_id: string;
      claimed_by: string | null;
      assignee_ids: string[];
    }>(
      sql`select task_id::text, claimed_by::text, assignee_ids::text[] from hub.task_holder(${s.kind}, ${s.subjectRef})`,
    );
    return rowsOf<{ task_id: string; claimed_by: string | null; assignee_ids: string[] | null }>(
      r,
    ).map(
      (x): FlowTaskHolder => ({
        taskId: x.task_id,
        claimedBy: x.claimed_by,
        assigneeIds: x.assignee_ids ?? [],
      }),
    );
  },
};
