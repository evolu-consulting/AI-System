// N2-FR-01 · N2-D04 · N2-D08 · plan N2 §2: cài đặt `PackRunsPort` cho module gói (cùng process, không HTTP nội bộ).
// start = `POST /process-runs` origin none (kiểm def/Group/trần/inputs như route) nhưng hoãn kick; cancel = huỷ của người
// bắt đầu (`GateService.cancel`); outcomes = MỘT câu theo tập trong scope user (RLS + lọc tenant tường minh).
// contract-flow S1a · cầu v2: `ensureDef` (= `DefsService.create/update`, idempotent theo `pack_version`), `start` + `ref`,
// `act` (= `GateService.reviewDecision` scope user), `cancelSys` (= `cancelEnd` scope system), đọc hệ thống MỘT câu lọc
// tenant tường minh; `stepsView` ở `pack-runs-view.ts`.
import { ProcessDefInputBaseSchema, type ProcessInputValue } from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import { publishUserEvents } from "../../../lib/user-stream";
import type {
  PackRunCaller,
  PackRunOutcome,
  PackRunOutcomeSys,
  PackRunsPort,
  PackWorkflow,
} from "../../packs/kit/application/pack-runs.ports";
import { availableToolRows, paramsOf } from "../adapters/tools/tool-switch.repo";
import * as core from "../core/core.repo";
import { processUpdated } from "../core/events";
import type { ProcessDeps } from "../core/ports";
import { DefsService } from "../defs/defs.service";
import { isTerminal } from "../domain/runs/run-state.rules";
import type { ProcessRunStatus } from "../domain/types";
import { cancelEnd } from "../gates/gates.effects";
import type * as g from "../gates/gates.repo";
import { GateService } from "../gates/gates.service";
import { openTaskFor, openTasksOf, stepsView, UUID } from "./pack-runs-view";
import { StartService } from "./start.service";

const asUser = (u: PackRunCaller): AuthUser => u as AuthUser;
const uuids = (xs: readonly string[]) => `{${xs.filter((x) => UUID.test(x)).join(",")}}`;
const PACK_KEY = /^[a-z][a-z0-9-]{0,39}$/;
const SYS = { kind: "system" as const };
/** dify-input-map · mô tả tham số từ `input_schema` (chuỗi không rỗng), để UI ánh xạ trường HĐ. */
function descOf(schema: unknown, name: string): string | undefined {
  if (!Array.isArray(schema)) return undefined;
  const p = (schema as { name?: unknown; description?: unknown }[]).find((x) => x?.name === name);
  return typeof p?.description === "string" && p.description ? p.description : undefined;
}
/** Lỗi engine coi như "đã có người làm trước" (đua) — không ném cho gói. */
const raced = (e: unknown, code: string) => e instanceof AppError && e.code === code;

async function ensureDef(
  d: ProcessDeps,
  u: PackRunCaller,
  def: { key: string; packVersion: number; body: Record<string, unknown> },
): Promise<"created" | "exists" | "synced"> {
  const input = ProcessDefInputBaseSchema.parse({ ...def.body, key: def.key });
  const svc = new DefsService(d);
  const scope = { tenantId: u.tenantId };
  const [cur] = await withHubScope(d.db, SYS, (tx) =>
    tx.execute<{ id: string; version: number; pack_version: number | null }>(sql`select id, version,
      pack_version from hub.process_defs where tenant_id = ${u.tenantId} and key = ${def.key}
      and deleted_at is null`),
  );
  if (cur && (cur.pack_version ?? 0) >= def.packVersion) return "exists";
  try {
    if (cur)
      await svc.update(asUser(u), scope, cur.id, { ...input, version: cur.version } as never);
    else await svc.create(asUser(u), scope, input as never);
  } catch (e) {
    // Hai instance cùng đồng bộ ⇒ bên sau "exists"; pack_version không ghi ⇒ lần gọi kế đồng bộ lại nếu cần.
    if (raced(e, "PROCESS_KEY_TAKEN") || raced(e, "VERSION_CONFLICT")) return "exists";
    throw e;
  }
  await withHubScope(d.db, SYS, (tx) =>
    tx.execute(sql`update hub.process_defs set pack_version = greatest(coalesce(pack_version, 0),
      ${def.packVersion}::int) where tenant_id = ${u.tenantId} and key = ${def.key} and deleted_at is null`),
  );
  return cur ? "synced" : "created";
}

/** Huỷ run ở scope system (khoá run trước — §10); không có trong tenant / đã kết thúc ⇒ false. */
async function cancelSys(d: ProcessDeps, tenantId: string, runId: string): Promise<boolean> {
  if (!UUID.test(runId) || !UUID.test(tenantId)) return false;
  const events = await withHubScope(d.db, SYS, async (tx) => {
    const run = await core.lockRun(tx, tenantId, runId);
    if (!run || isTerminal(run.status as ProcessRunStatus)) return null;
    const recipients = await core.runRecipients(tx, run.id, tenantId);
    const idx = Number(run.currentStageIdx);
    // Không có người thao tác (hệ thống) ⇒ run_end không kèm actor.
    const ref = null as unknown as g.ActorRef;
    const ev = await cancelEnd({ d, tx }, { run, idx, ref }, null);
    const upd = {
      id: run.id,
      status: "cancelled" as const,
      stageIdx: idx,
      step: Number(run.currentStep),
    };
    return [...ev, ...processUpdated(recipients, upd)];
  });
  if (events === null) return false;
  await publishUserEvents(d.redis, events, d.log);
  await d.postThread(runId).catch(() => {});
  return true;
}

const OUTCOME_SYS = (tenantIds: readonly string[], runIds: readonly string[]) => sql`
  select r.id as run_id, r.tenant_id, r.status, (rj.id is not null) as rejected, rj.feedback,
    r.snapshot->'stages'->(r.current_stage_idx::int)->>'key' as stage_key
  from hub.process_runs r
  left join lateral (select t.id, t.feedback from hub.review_tasks t where t.process_run_id = r.id
    and t.tenant_id = r.tenant_id and t.result = 'reject' limit 1) rj on true
  where r.id = any(${uuids(runIds)}::uuid[]) and r.tenant_id = any(${uuids(tenantIds)}::uuid[])`;

/**
 * Stage `done` mà task REVIEW đóng gần nhất là Đạt (`pass`) — stage bị quay lại rồi chưa xong không tính. fix-review: decision
 * `use_current` (coi như Đạt, không ai trong Group duyệt quyết) KHÔNG tính.
 */
const PASSED = (tenantId: string, runId: string) => sql`
  select r.snapshot->'stages'->(s.stage_idx::int)->>'key' as k
  from hub.stage_runs s join hub.process_runs r on r.id = s.process_run_id and r.tenant_id = s.tenant_id
  where s.process_run_id = ${runId} and s.tenant_id = ${tenantId} and s.status = 'done'
    and (select t.result from hub.review_tasks t where t.stage_run_id = s.id and t.tenant_id = s.tenant_id
      and t.kind = 'review' and t.status = 'closed'
      order by t.decided_at desc nulls last, t.created_at desc limit 1) = 'pass'
  order by s.stage_idx`;

/**
 * Huỷ bù của gói (`PackRunsPort.cancel`): run gắn gói không huỷ được qua API process-runs (fix-review) ⇒ người bắt đầu huỷ
 * run gắn gói của CHÍNH mình qua `cancelSys` (lọc tenant + `started_by`); run không gắn gói ⇒ như cũ (`GateService.cancel`).
 */
async function cancelOwn(d: ProcessDeps, gates: GateService, u: PackRunCaller, runId: string) {
  if (!UUID.test(runId) || !UUID.test(u.tenantId)) return;
  const [r] = await withHubScope(d.db, SYS, (tx) =>
    tx.execute<{
      own: boolean;
    }>(sql`select (started_by = ${u.userId}::uuid) as own from hub.process_runs
      where id = ${runId} and tenant_id = ${u.tenantId} and pack_key is not null`),
  );
  if (r?.own === true) await cancelSys(d, u.tenantId, runId);
  else await gates.cancel(asUser(u), runId);
}

function sysReads(d: ProcessDeps) {
  const read = <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) =>
    withHubScope(d.db, SYS, async (tx) => [...(await tx.execute<T>(q))]);
  return {
    async outcomesOf(tenantIds: string | readonly string[], runIds: readonly string[]) {
      const ts = typeof tenantIds === "string" ? [tenantIds] : tenantIds;
      if (ts.length === 0 || runIds.length === 0) return [];
      return read<PackRunOutcomeSys>(OUTCOME_SYS(ts, runIds));
    },
    async passedStages(tenantId: string, runId: string) {
      if (!UUID.test(runId) || !UUID.test(tenantId)) return [];
      const rows = await read<{ k: string | null }>(PASSED(tenantId, runId));
      return rows.flatMap((r) => (r.k ? [r.k] : []));
    },
    async lastApprover(tenantId: string, runId: string) {
      if (!UUID.test(runId) || !UUID.test(tenantId)) return null;
      const [r] = await read<{ by: string }>(sql`select decided_by as by from hub.review_tasks
        where process_run_id = ${runId} and tenant_id = ${tenantId} and kind = 'review' and result = 'pass'
          and decided_by is not null order by decided_at desc limit 1`);
      return r?.by ?? null;
    },
    /** cf-dify · cùng nguồn "tool khả dụng của tenant" với editor quy trình; bỏ workflow có tác dụng phụ (stage không `real_action`). */
    async workflowsOf(tenantId: string): Promise<PackWorkflow[]> {
      if (!UUID.test(tenantId)) return [];
      return withHubScope(d.db, SYS, async (tx) => {
        const rows = await availableToolRows(tx, tenantId);
        return rows
          .filter((r) => r.side_effect !== true)
          .map((r) => ({
            key: r.key,
            name: r.name,
            params: paramsOf(r.input_schema).map((p) => {
              const d = descOf(r.input_schema, p.name);
              return {
                name: p.name,
                type: p.type,
                required: p.required,
                ...(d ? { description: d } : {}),
                ...(p.options ? { options: [...p.options] } : {}),
              };
            }),
          }));
      });
    },
    async groupIdsOf(tenantId: string, keys: readonly string[]) {
      if (keys.length === 0 || !UUID.test(tenantId)) return new Map<string, string>();
      const rows = await read<{ id: string; key: string }>(sql`select id, key from admin.groups
        where tenant_id = ${tenantId} and key in (select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))`);
      return new Map(rows.map((r) => [r.key, r.id]));
    },
  };
}

export function packRunsOf(d: ProcessDeps): PackRunsPort {
  const start = new StartService(d);
  const gates = new GateService(d);
  return {
    async start(u, req) {
      const ref = req.ref;
      if (ref && (!PACK_KEY.test(ref.pack) || !UUID.test(ref.record_id)))
        throw new Error("PackRunsPort.start: ref không hợp lệ");
      const s = await start.createFromApi(
        asUser(u),
        {
          process_key: req.process_key,
          input: req.input,
          origin: { kind: "none" },
          ...(req.inputs ? { inputs: req.inputs as ProcessInputValue[] } : {}),
        },
        {
          deferKick: true,
          ...(ref ? { packRef: { pack: ref.pack, recordId: ref.record_id } } : {}),
        },
      );
      return { runId: s.id, kick: () => d.launcher.kick(s.id) };
    },
    cancel: (u, runId) => cancelOwn(d, gates, u, runId),
    async outcomes(u, runIds) {
      const ids = runIds.filter((x) => UUID.test(x));
      if (ids.length === 0) return [];
      const scope = { kind: "user" as const, userId: u.userId, tenantId: u.tenantId };
      return withHubScope(d.db, scope, async (tx) => {
        const rows = await tx.execute<PackRunOutcome>(sql`select r.id as run_id, r.status,
            (rj.id is not null) as rejected, rj.feedback
          from hub.process_runs r
          left join lateral (select t.id, t.feedback from hub.review_tasks t
            where t.process_run_id = r.id and t.tenant_id = r.tenant_id and t.result = 'reject' limit 1) rj on true
          where r.id = any(${`{${ids.join(",")}}`}::uuid[]) and r.tenant_id = ${u.tenantId}`);
        return [...rows];
      });
    },
    ensureDef: (u, key, def, version) => ensureDef(d, u, { key, packVersion: version, body: def }),
    async act(u, runId, at, b) {
      const taskId = await openTaskFor(d, u, runId, at);
      if (!taskId) return "not_open";
      const body = {
        result: b.result,
        ...(b.feedback !== undefined ? { feedback: b.feedback } : {}),
        ...(b.back_to_step !== undefined ? { back_to_step: b.back_to_step } : {}),
      };
      try {
        await gates.reviewDecision(asUser(u), taskId, body);
      } catch (e) {
        if (raced(e, "REVIEW_TASK_CLOSED")) return "not_open"; // người khác quyết trước (first-wins)
        throw e;
      }
      return "ok";
    },
    cancelSys: (tenantId, runId) => cancelSys(d, tenantId, runId),
    ...sysReads(d),
    stepsView: (u, runId) => stepsView(d, u, runId),
    openTasksOf: (u, packKey) => openTasksOf(d, u, packKey),
  };
}
