// CR-121 · cr121-c3a-overview-api · dữ liệu mồi dùng chung cho int/perf của `GET /ops/overview` (chỉ test). Đã đọc CHECK/NOT NULL:
// process_runs (status ∈ 8 giá trị, origin_kind 'admin' ⇒ không phòng/hội thoại gốc), review_tasks (kind 'ask' ⇒ cần `question`),
// dify_runs (trigger ∈ command|agent|schedule, status ∈ ok|failed|aborted), usage_logs (billing ∈ api|subscription|dify).
import type { Sql } from "@ai/test-kit/db";

export type Base = { def: string; user: string; conv: string };

/** Một quy trình + một người dùng + một hội thoại của tenant `t` để mọi lượt chạy mồi dùng chung (FK). */
export async function seedBase(o: Sql, t: string, tag: string): Promise<Base> {
  const [d] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
      run_group_ids, stages, token_budget, enabled, sources, inputs, slot, slot_body, published_version)
    select null, ${`ov-${tag}`}, 'Quy trình mồi', description, input_hint, run_group_ids, stages, token_budget, enabled,
      sources, inputs, slot, slot_body, 1
    from hub.process_defs where tenant_id is null and deleted_at is null limit 1 returning id::text as id`;
  const [u] = await o<
    { id: string }[]
  >`insert into admin.users (tenant_id, username, email, password_hash,
      display_name, role, locale, must_change_password)
    values (${t}, ${`ov-${tag}`}, ${`ov-${tag}@example.invalid`}, 'x', 'ov', 'member', 'vi', false) returning id::text as id`;
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${t}, ${u?.id as string}, 'c', 'c') returning id::text as id`;
  return { def: d?.id as string, user: u?.id as string, conv: c?.id as string };
}

export type RunSeed = {
  id?: string;
  tenant: string;
  status: string;
  /** Phút TRƯỚC `now()`. */
  startedAgo: number;
  finishedAgo?: number | null;
  updatedAgo?: number;
  rerunOf?: string | null;
};

/** Chèn lượt chạy theo danh sách (một câu). `finishedAgo`/`updatedAgo` vắng ⇒ null / = started. */
export async function insertRuns(o: Sql, b: Base, runs: readonly RunSeed[]): Promise<string[]> {
  const rows = runs.map((r) => ({
    id: r.id ?? crypto.randomUUID(),
    tenant_id: r.tenant,
    status: r.status,
    s: r.startedAgo,
    f: r.finishedAgo ?? null,
    u: r.updatedAgo ?? r.finishedAgo ?? r.startedAgo,
    re: r.rerunOf ?? null,
  }));
  await o`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind,
      input, conversation_id, flow_id, status, expires_at, started_at, finished_at, updated_at, rerun_of)
    select x.id::uuid, x.tenant_id::uuid, ${b.def}::uuid, 1, '{}'::jsonb, ${b.user}::uuid, 'admin', 'x', ${b.conv}::uuid,
      gen_random_uuid(), x.status, now() + interval '1 day',
      now() - x.s * interval '1 minute',
      case when x.f is null then null else now() - x.f * interval '1 minute' end,
      now() - x.u * interval '1 minute', x.re::uuid
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      as x(id text, tenant_id text, status text, s float8, f float8, u float8, re text)`;
  return rows.map((r) => r.id);
}

/** Một bước + một việc duyệt đã đóng `waitMin` phút cho lượt `runId` (để kiểm "p95 trừ thời gian chờ người duyệt"). */
export async function insertReviewWait(
  o: Sql,
  tenant: string,
  runId: string,
  createdAgo: number,
  decidedAgo: number,
): Promise<void> {
  const [s] = await o<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx)
    values (${tenant}, ${runId}, 0) returning id::text as id`;
  await o`insert into hub.review_tasks (tenant_id, process_run_id, stage_run_id, kind, status, question, result,
      decided_at, created_at)
    values (${tenant}, ${runId}, ${s?.id as string}, 'ask', 'closed', 'q', 'answer',
      now() - ${decidedAgo} * interval '1 minute', now() - ${createdAgo} * interval '1 minute')`;
}

export type DifySeed = { workflow: string; tenant: string; status: "ok" | "failed"; ago: number };

export async function insertDify(o: Sql, rows: readonly DifySeed[]): Promise<void> {
  await o`insert into hub.dify_runs (tenant_id, workflow_id, trigger, status, created_at)
    select x.t::uuid, x.w::uuid, 'command', x.s, now() - x.a * interval '1 minute'
    from jsonb_to_recordset(${JSON.stringify(rows.map((r) => ({ t: r.tenant, w: r.workflow, s: r.status, a: r.ago })))}::jsonb)
      as x(t text, w text, s text, a float8)`;
}
