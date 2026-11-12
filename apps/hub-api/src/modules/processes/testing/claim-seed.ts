// CR-127 · E2 · dữ liệu int cho Nhận việc: công ty, người dùng, phòng (có / không trưởng phòng), task duyệt giao phòng.
// Chỉ dùng trong `*.int.test.ts` (SQL owner, DB clone từ mẫu). SQL thuần — không kéo fixture H1 (dựng cả app).
import { department, tenants, users } from "@ai/test-kit/builders";
import type { Sql } from "@ai/test-kit/db";

export type ClaimWorld = {
  T: string;
  /** người gửi · A, B thành viên phòng G · H trưởng phòng G · X ngoài phòng · TA quản trị công ty */
  S: string;
  A: string;
  B: string;
  H: string;
  X: string;
  TA: string;
  /** phòng có trưởng phòng · phòng KHÔNG có trưởng phòng (thành viên A, B) */
  G: string;
  G0: string;
  defId: string;
  groupsOf: Map<string, string[]>;
};

const SNAP = {
  key: "claim-t",
  name: "Duyệt nhóm",
  token_budget: null,
  run_group_ids: [],
  stages: [{ key: "duyet", name: "Duyệt", step: 0, after: { kind: "review", group_id: null } }],
};

export async function claimWorld(o: Sql, n: number): Promise<ClaimWorld> {
  const [T] = (await tenants(o, 1, n)) as [string];
  const [S, A, B, H, X] = (await users(o, T, 5, { from: n * 100 })) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const [TA] = (await users(o, T, 1, { from: n * 100 + 50, role: "tenant_admin" })) as [string];
  const G = await department(o, T, `pb-${n}`, { head: H, members: [A, B] });
  const G0 = await department(o, T, `pb0-${n}`, { head: null, members: [A, B] });
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${T}, ${`claim-${n}`}, 'Duyệt nhóm', ${o.json(SNAP.stages as never)}) returning id::text as id`;
  const groupsOf = new Map<string, string[]>([
    [A, [G, G0]],
    [B, [G, G0]],
    [H, [G]],
  ]);
  return { T, S, A, B, H, X, TA, G, G0, defId: d?.id as string, groupsOf };
}

/** Một lượt đang chờ duyệt + task duyệt mở giao phòng `groupId` (need mặc định 'one'). */
export async function groupTask(
  o: Sql,
  w: ClaimWorld,
  groupId: string,
  /** CR-127 · E3 · `after` của bước (vd head_only) — vắng ⇒ duyệt cả nhóm. */
  after?: Record<string, unknown>,
): Promise<{ runId: string; taskId: string; stageRunId: string; outputId: string }> {
  const snap = after ? { ...SNAP, stages: [{ ...SNAP.stages[0], after }] } : SNAP;
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${w.T}, ${w.S}, 'c', 'c') returning id::text as id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, current_step, current_stage_idx, status)
    values (${w.T}, ${w.defId}, 1, ${o.json(snap as never)}, ${w.S}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), 0, 0, 'waiting_review') returning id::text as id`;
  const runId = r?.id as string;
  const [s] = await o<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
    values (${w.T}, ${runId}, 0, 'waiting_review') returning id::text as id`;
  const stageRunId = s?.id as string;
  const [out] = await o<
    { id: string }[]
  >`insert into hub.process_outputs (tenant_id, process_run_id, stage_run_id,
      stage_idx, version, attempt, content, template_ok)
    values (${w.T}, ${runId}, ${stageRunId}, 0, 1, 1, 'x', true) returning id::text as id`;
  await o`update hub.stage_runs set current_output_id = ${out?.id as string} where id = ${stageRunId}`;
  const [t] = await o<
    { id: string }[]
  >`insert into hub.review_tasks (tenant_id, process_run_id, stage_run_id, kind,
      status, output_id, assignee_group_id, remind_at)
    values (${w.T}, ${runId}, ${stageRunId}, 'review', 'open', ${out?.id as string}, ${groupId},
      now() + interval '1 day') returning id::text as id`;
  const taskId = t?.id as string;
  await o`insert into hub.review_task_assignees (tenant_id, task_id, group_id, via, depth)
    values (${w.T}, ${taskId}, ${groupId}, 'initial', 0)`;
  return { runId, taskId, stageRunId, outputId: out?.id as string };
}
