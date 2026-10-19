// HD3 · HD-FR-31…34 · #219 · D3-01/D3-05/D3-12: phần mở rộng `PackRunsPort` cho flow duyệt của gói (cùng process, không HTTP
// nội bộ). `agent` = job agent KHÔNG tool gắn `hub.runs` đang chạy của stage tool gọi (bền theo engine, huỷ theo `signal`);
// `ensureDef` = `DefsService.create/update` (cùng luật lưu); `state`/`act` = task duyệt mở + `can_act`/quyết như route engine;
// `outcomesOf`/`lastApprover` = MỘT câu, scope system + lọc tenant tường minh. Không log nội dung prompt/đầu ra.
import { ProcessDefInputBaseSchema } from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import type {
  PackAgentReply,
  PackAgentRequest,
  PackRunCaller,
  PackRunOutcomeSys,
  PackRunState,
  PackRunsPort,
} from "../../packs/kit/application/pack-runs.ports";
import { runJob } from "../../runner/job/job-agent-runner";
import type { ProcessDeps } from "../core/ports";
import { loadTaskDetails } from "../core/task-view";
import { DefsService } from "../defs/defs.service";
import { GateService } from "../gates/gates.service";

type Hd3Port = Omit<PackRunsPort, "start" | "cancel" | "outcomes">;
const asUser = (u: PackRunCaller): AuthUser => u as AuthUser;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (xs: readonly string[]) => `{${xs.filter((x) => UUID.test(x)).join(",")}}`;
const vrole = (r: string) => (r === "platform_admin" || r === "tenant_admin" ? r : "member");

type HubRunRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  conversation_id: string;
  flow_id: string;
  process_run_id: string | null;
  stage_run_id: string | null;
};

/** `hub.runs` đang chạy của stage tool (đúng tenant) — chỉ khi đó mới chạy job agent dưới nó. */
async function runningStageRun(d: ProcessDeps, r: PackAgentRequest): Promise<HubRunRow | null> {
  const [row] = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<HubRunRow>(sql`select id, tenant_id, user_id, conversation_id, flow_id, process_run_id,
        stage_run_id from hub.runs where id = ${r.hubRunId} and tenant_id = ${r.tenantId}
        and status = 'running' and stage_run_id is not null`),
  );
  return row ?? null;
}

async function agent(d: ProcessDeps, r: PackAgentRequest): Promise<PackAgentReply> {
  if (!UUID.test(r.hubRunId)) return { ok: false, code: "AGENT_UNAVAILABLE" };
  const [run, snap] = await Promise.all([runningStageRun(d, r), d.config.snapshot()]);
  const cfg = snap.agents.find((a) => a.key === r.agentKey && a.enabled);
  if (!run || !cfg) return { ok: false, code: "AGENT_UNAVAILABLE" };
  const o = await runJob(
    d.runner,
    {
      run: {
        id: run.id,
        tenantId: run.tenant_id,
        userId: run.user_id,
        conversationId: run.conversation_id,
        flowId: run.flow_id,
        locale: "vi",
      },
      snapshot: snap,
      agent: cfg,
      role: "agent",
      prompt: r.prompt,
      systemPrompt: r.system,
      history: [],
      useSession: false,
      noTools: true,
      detail: {
        process_run_id: run.process_run_id,
        stage_run_id: run.stage_run_id,
        team_run_id: null,
        member_key: null,
        role: "agent",
      },
    },
    r.signal,
    d.log,
  );
  if (o.kind === "aborted") return { ok: false, code: "TIMEOUT" };
  if (o.kind === "failed")
    return { ok: false, code: o.code === "TIMEOUT" ? "TIMEOUT" : "AGENT_FAILED" };
  const out = o.output;
  if (out.kind === "text") return { ok: true, text: out.text };
  return out.result.status === "need_input"
    ? { ok: false, code: "AGENT_FAILED" }
    : { ok: true, text: out.result.text };
}

async function ensureDef(
  d: ProcessDeps,
  u: PackRunCaller,
  def: { key: string } & Record<string, unknown>,
  o: { sync?: boolean } = {},
): Promise<"created" | "exists" | "synced"> {
  const input = ProcessDefInputBaseSchema.parse(def);
  const svc = new DefsService(d);
  const scope = { tenantId: u.tenantId };
  const [cur] = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<{ id: string; version: number }>(sql`select id, version from hub.process_defs
      where tenant_id = ${u.tenantId} and key = ${input.key} and deleted_at is null`),
  );
  if (cur && !o.sync) return "exists";
  if (cur) {
    await svc.update(asUser(u), scope, cur.id, { ...input, version: Number(cur.version) } as never);
    return "synced";
  }
  try {
    await svc.create(asUser(u), scope, input as never);
    return "created";
  } catch (e) {
    // Hai instance cùng dựng (đua) ⇒ khoá đã có = như "exists".
    if (e instanceof AppError && e.code === "PROCESS_KEY_TAKEN") return "exists";
    throw e;
  }
}

type StateRow = {
  status: string;
  stage_key: string | null;
  task_id: string | null;
  rejected: boolean;
  feedback: string | null;
};

/** 1 câu: run + stage hiện tại + task duyệt mở (+ lý do Từ chối nếu có) trong tenant người xem. */
async function stateRow(d: ProcessDeps, u: PackRunCaller, runId: string) {
  return withHubScope(
    d.db,
    { kind: "user", userId: u.userId, tenantId: u.tenantId },
    async (tx) => {
      const [r] = await tx.execute<StateRow>(sql`select r.status,
        r.snapshot->'stages'->(r.current_stage_idx::int)->>'key' as stage_key,
        (select t.id from hub.review_tasks t where t.process_run_id = r.id and t.tenant_id = r.tenant_id
          and t.kind = 'review' and t.status = 'open' order by t.created_at desc limit 1) as task_id,
        (rj.id is not null) as rejected, rj.feedback
      from hub.process_runs r
      left join lateral (select t.id, t.feedback from hub.review_tasks t where t.process_run_id = r.id
        and t.tenant_id = r.tenant_id and t.result = 'reject' limit 1) rj on true
      where r.id = ${runId} and r.tenant_id = ${u.tenantId}`);
      if (!r) return null;
      if (!r.task_id) return { r, canAct: false };
      const groupIds = (await d.config.user(u.userId))?.groupIds ?? new Set<string>();
      const v = { userId: u.userId, tenantId: u.tenantId, role: vrole(u.role) as never, groupIds };
      const [t] = await loadTaskDetails(tx, v, [r.task_id]);
      return { r, canAct: t?.can_act === true };
    },
  );
}

async function state(
  d: ProcessDeps,
  u: PackRunCaller,
  runId: string,
): Promise<PackRunState | null> {
  if (!UUID.test(runId)) return null;
  const got = await stateRow(d, u, runId);
  if (!got) return null;
  const { r, canAct } = got;
  return {
    run_id: runId,
    status: r.status,
    stage_key: r.stage_key,
    task: r.task_id ? { id: r.task_id, can_act: canAct } : null,
    rejected: r.rejected,
    feedback: r.feedback,
  };
}

export function packRunsHd3(d: ProcessDeps): Hd3Port {
  const gates = new GateService(d);
  return {
    ensureDef: (u, def, o) => ensureDef(d, u, def, o),
    agent: (r) => agent(d, r),
    state: (u, runId) => state(d, u, runId),
    async act(u, runId, b) {
      const s = await state(d, u, runId);
      if (!s?.task) return "not_open";
      await gates.reviewDecision(asUser(u), s.task.id, b);
      return "ok";
    },
    async outcomesOf(tenantIds, runIds): Promise<PackRunOutcomeSys[]> {
      if (tenantIds.length === 0 || runIds.length === 0) return [];
      return withHubScope(d.db, { kind: "system" }, async (tx) => [
        ...(await tx.execute<PackRunOutcomeSys>(sql`select r.id as run_id, r.tenant_id, r.status,
            (rj.id is not null) as rejected, rj.feedback
          from hub.process_runs r
          left join lateral (select t.id, t.feedback from hub.review_tasks t where t.process_run_id = r.id
            and t.tenant_id = r.tenant_id and t.result = 'reject' limit 1) rj on true
          where r.id = any(${uuids(runIds)}::uuid[]) and r.tenant_id = any(${uuids(tenantIds)}::uuid[])`)),
      ]);
    },
    async lastApprover(tenantId, runId) {
      if (!UUID.test(runId)) return null;
      const [r] = await withHubScope(d.db, { kind: "system" }, (tx) =>
        tx.execute<{ by: string }>(sql`select decided_by as by from hub.review_tasks
          where process_run_id = ${runId} and tenant_id = ${tenantId} and kind = 'review'
            and result = 'pass' order by decided_at desc limit 1`),
      );
      return r?.by ?? null;
    },
    async groupIdsOf(tenantId, keys) {
      if (keys.length === 0) return new Map();
      const rows = await withHubScope(d.db, { kind: "system" }, (tx) =>
        tx.execute<{ id: string; key: string }>(sql`select id, key from admin.groups
          where tenant_id = ${tenantId} and key in (${sql.join(
            keys.map((k) => sql`${k}`),
            sql`, `,
          )})`),
      );
      return new Map(rows.map((r) => [r.key, r.id]));
    },
  };
}
