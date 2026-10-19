// HUB-FR-146 · AC-H44 · D2-15/D2-30 · plan-d2 §4, §8, §10 S2/S9/S10: đọc `loadCall` của `ToolStageRepo` (MỘT câu SQL) và
// ánh xạ hàng → `ToolCallLoad`; tách khỏi `tool-stage.repo.ts` để giữ trần 200 dòng adapter (PD-A03).
import { InputSchemaSchema } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ToolCallLoad } from "../../application/tools/tool.ports";
import type { ArgSource } from "../../domain/tools/tool-run.rules";

type LoadRow = {
  stage_name: string;
  tool_key: string;
  args: Record<string, RawArg> | null;
  out_fields: { key: string; type: string; required: boolean }[] | null;
  timeout_s: number | null;
  inputs: RawInput[] | null;
  src_fields: Record<string, Record<string, string | number> | null> | null;
  started_by: string;
  workflow_id: string | null;
  side_effect: boolean | null;
  real_action: boolean | null;
  input_schema: unknown;
  wf_enabled: boolean | null;
  switch_on: boolean;
  wf_name: string | null;
  app_type: string | null;
  base_url: string | null;
  output_field: string | null;
  usable: boolean | null;
  can_run: boolean | null;
  retry_count: number;
  retry_attempt: number | null;
  retry_round: number | null;
  attempt: number;
  round: number;
};
type RawArg = { from: string; key?: string; stage_key?: string; field?: string; value?: unknown };
type RawInput = { type: string; key: string; text?: string; value?: string };

/**
 * MỘT câu (D2-15, S2/S9/S10): stage `running` ∧ `current_run_id = hubRunId`; công tắc theo `t.tenant_id = r.tenant_id`
 * (hub_ro `USING (true)` ⇒ lọc tường minh); fields nguồn = output hiện hành của mọi stage run (≤ 10, `skipped` ⇒ null).
 */
export async function loadCallRow(
  tx: Tx,
  k: { tenantId: string; runId: string; stageRunId: string; hubRunId: string },
): Promise<LoadRow | null> {
  const [r] = await tx.execute<LoadRow>(sql`select st->>'name' as stage_name,
      st->'executor'->>'tool_key' as tool_key, st->'executor'->'args' as args,
      st->'output'->'fields' as out_fields, (st->>'timeout_s')::int as timeout_s, r.inputs, r.started_by,
      (select jsonb_object_agg(r.snapshot->'stages'->(o.stage_idx::int)->>'key',
          case when o.status = 'skipped' then null else po.fields end)
        from hub.stage_runs o left join hub.process_outputs po
          on po.id = o.current_output_id and po.tenant_id = o.tenant_id
        where o.process_run_id = r.id and o.tenant_id = r.tenant_id) as src_fields,
      w.id as workflow_id, w.side_effect, (st->>'real_action')::boolean as real_action, w.input_schema,
      w.enabled as wf_enabled, (t.workflow_id is not null) as switch_on,
      w.name as wf_name, w.app_type, w.base_url, w.output_field,
      (u.active and not u.locked_by_tenant and tn.active) as usable,
      (cardinality(d.run_group_ids) = 0 or exists (select 1 from admin.group_members gm
        where gm.tenant_id = r.tenant_id and gm.user_id = r.started_by and gm.group_id = any(d.run_group_ids))) as can_run,
      s.retry_count, s.retry_attempt, s.retry_round, s.attempt, s.round
    from hub.stage_runs s
    join hub.process_runs r on r.id = s.process_run_id and r.tenant_id = s.tenant_id
    cross join lateral (select r.snapshot->'stages'->(s.stage_idx::int) as st) x
    left join hub.process_defs d on d.id = r.process_def_id and d.tenant_id = r.tenant_id
    left join admin.workflows w on w.key = st->'executor'->>'tool_key'
    left join admin.tenant_workflow_tools t
      on t.workflow_id = w.id and t.tenant_id = r.tenant_id and t.revoked_at is null
    left join admin.users u on u.id = r.started_by and u.tenant_id = r.tenant_id
    left join admin.tenants tn on tn.id = r.tenant_id
    where s.id = ${k.stageRunId} and s.process_run_id = ${k.runId} and s.tenant_id = ${k.tenantId}
      and s.status = 'running' and s.current_run_id = ${k.hubRunId}`);
  return r ?? null;
}

const argOf = (a: RawArg): ArgSource =>
  a.from === "field"
    ? { from: "field", stageKey: a.stage_key ?? "", field: a.field ?? "" }
    : a.from === "input"
      ? { from: "input", key: a.key ?? "" }
      : { from: "const", value: a.value as string | number | boolean };

/** Giá trị chuỗi của input start: `text` ⇒ `text`; select/date/number ⇒ `value`; kiểu khác không làm nguồn. */
const inputText = (v: RawInput): string | undefined => (v.type === "text" ? v.text : v.value);

/** Workflow đã xoá khỏi catalog ⇒ `wfEnabled=false` ⇒ `tool_failed` (không kẹt `running`). */
export function toLoad(r: LoadRow): ToolCallLoad {
  const inputs = new Map<string, string>();
  const inputTypes = new Map<string, string>();
  for (const v of r.inputs ?? []) {
    const t = inputText(v);
    if (t !== undefined) inputs.set(v.key, t);
    inputTypes.set(v.key, v.type);
  }
  const args = Object.fromEntries(Object.entries(r.args ?? {}).map(([n, a]) => [n, argOf(a)]));
  return {
    stageName: r.stage_name,
    toolKey: r.tool_key,
    workflowId: r.workflow_id ?? "",
    sideEffect: r.side_effect === true,
    realAction: r.real_action === true,
    inputSchemaOk: InputSchemaSchema.safeParse(r.input_schema).success,
    timeoutS: Number(r.timeout_s ?? 0),
    args,
    outputFields: r.out_fields ?? [],
    inputs,
    inputTypes,
    fields: new Map(Object.entries(r.src_fields ?? {})),
    startedBy: r.started_by,
    usable: r.usable === true,
    canRun: r.can_run === true,
    switchOn: r.switch_on === true,
    wfEnabled: r.wf_enabled === true,
    ...(r.workflow_id && r.app_type && r.base_url
      ? {
          endpoint: {
            key: r.tool_key,
            name: r.wf_name ?? r.tool_key,
            appType: r.app_type,
            baseUrl: r.base_url,
            outputField: r.output_field,
          },
        }
      : {}),
    state: {
      retryCount: Number(r.retry_count),
      retryAttempt: r.retry_attempt === null ? null : Number(r.retry_attempt),
      retryRound: r.retry_round === null ? null : Number(r.retry_round),
      attempt: Number(r.attempt),
      round: Number(r.round),
    },
  };
}
