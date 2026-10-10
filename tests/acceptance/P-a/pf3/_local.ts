// HUB-FR-112 · HUB-BR-25 · fixture riêng PF3 (test-plan-int §4): task review gán Group Kế toán (+ T ngoài phòng) + notice
// `process_notices` bằng SQL owner (không cần PF1). CHỈ gọi sau `c.ready`. Không sửa `_support/`. Payload notice theo plan
// §2.1 ("tên quy trình/stage, kết quả; không nội dung output").
import {
  type CtxPa,
  defInput,
  insertDef,
  insertOutput,
  insertRun,
  insertTask,
  type Json,
  PA,
  PA_FIX,
  type RunFix,
  T,
} from "../_support/pa";

type Who = { id: string; tid: string };

/** Def `hoa-don-t` (acme), stage 0 review Group Kế toán. */
export function defKT() {
  const d = defInput({ groupId: PA_FIX.gKeToan });
  return {
    id: PA_FIX.defHoaDon,
    key: d.key as string,
    name: d.name as string,
    stages: d.stages as Json[],
  };
}
export async function seedDef(c: CtxPa): Promise<void> {
  await insertDef(c.sql, {
    id: PA_FIX.defHoaDon,
    tenantId: T.acme,
    input: defInput({ groupId: PA_FIX.gKeToan }),
  });
}

export type ReviewFix = { run: RunFix; taskId: string; outputId: string };
/** Run `waiting_review` stage 0 (origin R) + output v1 + task review open gán Group Kế toán (B, T). */
export async function reviewRun(
  c: CtxPa,
  o: { by?: Who; status?: "open" | "closed"; userIds?: string[]; roomId?: string | null } = {},
): Promise<ReviewFix> {
  const by = o.by ?? PA.A;
  const run = await insertRun(c.sql, {
    def: defKT(),
    startedBy: by,
    roomId: o.roomId === undefined ? PA_FIX.room : o.roomId,
    status: "waiting_review",
  });
  const sr = run.stageRunIds[0] as string;
  const outputId = await insertOutput(c.sql, {
    tid: by.tid,
    runId: run.runId,
    stageRunId: sr,
    stageIdx: 0,
  });
  const taskId = await insertTask(c.sql, {
    tid: by.tid,
    runId: run.runId,
    stageRunId: sr,
    kind: "review",
    outputId,
    groupId: PA_FIX.gKeToan,
    userIds: o.userIds,
    status: o.status,
  });
  return { run, taskId, outputId };
}

/** Một hàng `process_notices` cho `user` (DM "Quy trình", D12). */
export async function insertNotice(
  c: CtxPa,
  o: { user: Who; runId: string; taskId?: string | null; kind?: string; read?: boolean },
): Promise<string> {
  const [r] = await c.sql<
    Json[]
  >`insert into hub.process_notices (tenant_id, user_id, kind, process_run_id, task_id, payload,
      read_at)
    values (${o.user.tid}, ${o.user.id}, ${o.kind ?? "review_requested"}, ${o.runId}, ${o.taskId ?? null},
      ${c.sql.json({ process_name: "Hoá đơn thử", stage_name: "Đọc hoá đơn" })}, ${o.read ? new Date() : null})
    returning id`;
  return r?.id as string;
}
export async function notices(c: CtxPa, userId: string, kind?: string): Promise<Json[]> {
  return kind
    ? c.sql<
        Json[]
      >`select id, kind, task_id from hub.process_notices where user_id = ${userId} and kind = ${kind}`
    : c.sql<Json[]>`select id, kind, task_id from hub.process_notices where user_id = ${userId}`;
}

/** `GET /me/review-tasks` → id task theo thứ tự. */
export async function myTaskIds(
  c: CtxPa,
  r: Parameters<CtxPa["call"]>[0],
  qs = "",
): Promise<string[]> {
  const res = await c.call(r, "GET", `/me/review-tasks${qs}`);
  return (res.json?.items ?? []).map((i: Json) => i.task?.id);
}
