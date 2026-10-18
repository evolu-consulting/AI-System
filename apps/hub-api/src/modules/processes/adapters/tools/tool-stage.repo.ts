// HUB-FR-146 · AC-H44 · AC-H47 · D2-15/D2-30 · plan-d2 §3–§4, §8, §10 S2/S9/S10: `ToolStageRepo` gắn tx + tenant của UoW.
// `loadCall` = MỘT câu đọc (stage running của hub run + snapshot + inputs + fields nguồn + công tắc của ĐÚNG tenant run +
// workflow enabled + usable + canRun). `settleOk` đi đường hậu-output của stage agent (`transition` + `effects`: review ⇒
// waiting_review + task; auto ⇒ done + join). Mọi câu lọc `tenant_id`; sự kiện/kick/thread vào outbox (phát sau COMMIT).
import { InputSchemaSchema } from "@ai/contracts";
import type { ProcessRunStatus } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Outbox } from "../../application/ports";
import type {
  ToolCallAudit,
  ToolCallLoad,
  ToolStageRepo,
} from "../../application/tools/tool.ports";
import * as core from "../../core/core.repo";
import { processUpdated } from "../../core/events";
import type { ProcessDeps } from "../../core/ports";
import { type RunState, transition } from "../../domain/runs/run-state.rules";
import { stageGateStatus, stepCountOf } from "../../domain/runs/step.rules";
import type { ArgSource } from "../../domain/tools/tool-run.rules";
import { type StageRowIdx, stepsOfSnap } from "../../runs/step-persist";
import { effects, headOf, type RunHead, type SnapStage, toDecision } from "../../runs/team-runner";

type Deps = Omit<ProcessDeps, "launcher" | "start">;

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
async function loadCallRow(
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
function toLoad(r: LoadRow): ToolCallLoad {
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

/** D1 · trạng thái "run" dựng từ stage (như `stage-driver.buildState`): bước/tổng bước. */
function stateOf(head: RunHead, stage: StageRowIdx, def: SnapStage): RunState {
  const steps = stepsOfSnap(head.snapshot);
  return {
    status: stageGateStatus(head.status as ProcessRunStatus, stage.status),
    stageIdx: steps[stage.stage_idx] ?? stage.stage_idx,
    stageCount: stepCountOf(steps),
    stage: {
      status: stage.status,
      attempt: Number(stage.attempt),
      attemptLimit: Number(stage.attempt_limit),
      asksCount: Number(stage.asks_count),
      askLimit: Number(stage.ask_limit),
      after: def.after.kind,
      hasOutput: stage.current_output_id !== null,
      realAction: def.real_action === true,
    },
    decisionReason: null,
  };
}

type LockedRow = StageRowIdx & { head: RunHead };
type LockRaw = Omit<StageRowIdx, "stage_idx"> & {
  stage_idx: number | string;
  r_tenant_id: string;
  r_started_by: string;
  r_status: string;
  r_current_stage_idx: number;
  r_input: string;
  r_snapshot: RunHead["snapshot"];
};

/**
 * MỘT câu (T18-perf): `for update of s` hàng stage + đầu run (`headOf`) cùng lúc. Gọi SAU `runs.lock` (thứ tự khoá run →
 * stage giữ nguyên; run đã khoá nên đầu run đọc ở đây là bản mới nhất).
 */
async function lockStageWithHead(
  tx: Tx,
  tenantId: string,
  stageRunId: string,
): Promise<LockedRow | null> {
  const [s] = await tx.execute<LockRaw>(sql`select s.id, s.stage_idx, s.status, s.attempt,
      s.attempt_limit, s.asks_count, s.ask_limit, s.current_output_id, s.current_run_id,
      r.tenant_id as r_tenant_id, r.started_by as r_started_by, r.status as r_status,
      r.current_stage_idx as r_current_stage_idx, r.input as r_input, r.snapshot as r_snapshot
    from hub.stage_runs s join hub.process_runs r on r.id = s.process_run_id and r.tenant_id = s.tenant_id
    where s.id = ${stageRunId} and s.tenant_id = ${tenantId} for update of s`);
  if (!s) return null;
  const { r_tenant_id, r_started_by, r_status, r_current_stage_idx, r_input, r_snapshot, ...st } =
    s;
  const head: RunHead = {
    tenant_id: r_tenant_id,
    started_by: r_started_by,
    status: r_status,
    current_stage_idx: r_current_stage_idx,
    input: r_input,
    snapshot: r_snapshot,
  };
  return { ...st, stage_idx: Number(st.stage_idx), head };
}

/** PD2-R09 · audit `tool_call` — actor = người bắt đầu (gọi bằng danh tính họ, S1); `summary` chỉ id/mã/thời gian. */
async function insertAudit(tx: Tx, tenantId: string, x: ToolCallAudit): Promise<void> {
  const summary = {
    run_id: x.runId,
    stage_run_id: x.stageRunId,
    tool_key: x.toolKey,
    started_by: x.startedBy,
    status: x.status,
    code: x.code,
    ms: x.ms,
  };
  await tx.execute(sql`insert into hub.audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id,
      entity_name, summary)
    values (${tenantId}::uuid, ${x.startedBy}::uuid, null, 'tool_call', 'process_run', ${x.runId}::uuid,
      ${x.toolKey.slice(0, 200)}, ${JSON.stringify(summary)}::jsonb)`);
}

export function toolStageRepo(tx: Tx, tenantId: string, outbox: Outbox, d: Deps): ToolStageRepo {
  /** Hàng stage đã khoá ở `lockRunning` (dùng lại trong `settleOk`/`decide`, không đọc lại). */
  let locked: StageRowIdx | null = null;
  let head: RunHead | null = null;
  const emit = (runId: string, events: readonly unknown[], kick: boolean) => {
    if (events.length > 0) outbox.emit({ kind: "user_events", events });
    outbox.emit({ kind: "post_thread", runId });
    if (kick) outbox.emit({ kind: "kick", runId });
  };
  return {
    async loadCall(runId, stageRunId, hubRunId): Promise<ToolCallLoad | null> {
      const row = await loadCallRow(tx, { tenantId, runId, stageRunId, hubRunId });
      return row ? toLoad(row) : null;
    },
    audit: (x) => insertAudit(tx, tenantId, x),
    async retried(runId) {
      const idx = locked?.stage_idx;
      const h = idx === undefined ? null : await headOf(tx, runId);
      if (!h || idx === undefined) return;
      const recipients = await core.runRecipients(tx, runId, tenantId);
      const step = stepsOfSnap(h.snapshot)[idx] ?? idx;
      const st = { id: runId, status: h.status as ProcessRunStatus, stageIdx: idx, step };
      outbox.emit({ kind: "user_events", events: processUpdated(recipients, st) });
    },
    async lockRunning(stageRunId, hubRunId) {
      const row = await lockStageWithHead(tx, tenantId, stageRunId);
      const ok = row?.status === "running" && row.current_run_id === hubRunId;
      locked = ok ? row : null;
      head = ok ? row.head : null;
      return locked !== null;
    },
    async settleOk(x) {
      // T18-perf: đầu run đọc CÙNG câu khoá stage (run đã khoá ở `runs.lock` ⇒ ảnh mới nhất), không đọc lại.
      const h = head ?? (await headOf(tx, x.runId));
      const stage = locked;
      const def = stage && h?.snapshot.stages[stage.stage_idx];
      if (!h || !stage || !def) return;
      const ev = { kind: "stage_output", templateOk: true } as const;
      const t = transition(stateOf(h, stage, def), ev);
      if (!t.ok) return;
      const result = { kind: "output" as const, text: x.md };
      const apply = {
        runId: x.runId,
        stageRunId: x.stageRunId,
        hubRunId: x.hubRunId,
        jobId: null,
        result,
        tokens: 0,
      };
      const ctx = {
        x: apply,
        head: h,
        stage,
        def,
        idx: stage.stage_idx,
        ev,
        next: t.next,
        list: t.effects,
      };
      // Không blob/hàng attachment (`outputAttachment` bỏ stage `tool` — không job): .md tool nhỏ, inline như stage Áp.
      const res = await effects({ ...d, storage: undefined }, tx, ctx);
      const st = res.step;
      if (st) {
        const recipients = await core.runRecipients(tx, x.runId, tenantId);
        const s = { id: x.runId, status: st.status, stageIdx: st.stageIdx, step: st.step };
        res.events.push(...processUpdated(recipients, s));
      }
      emit(x.runId, res.events, res.kick);
    },
    async decide(x) {
      const idx = locked?.stage_idx;
      if (idx === undefined) return;
      const p = { runId: x.runId, tenantId, idx, stageRunId: x.stageRunId, reason: x.reason };
      const events = await toDecision(d, tx, p);
      const recipients = await core.runRecipients(tx, x.runId, tenantId);
      const st = { id: x.runId, status: "needs_decision" as const, stageIdx: idx };
      events.push(...processUpdated(recipients, st));
      emit(x.runId, events, false);
    },
  };
}
