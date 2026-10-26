// HD-FR-31…37 · D3-13/D3-14 · M3-decouple: SQL máy trạng thái duyệt trong tx `PackUow` (role `contracts_rw`, RLS FORCE) +
// `tenant_id` tường minh. Mỗi hàm MỘT câu văn bản hằng; ghi có điều kiện `run_id` (= id lượt duyệt) + trạng thái (idempotent,
// nhiều instance an toàn). Chỉ mục duy nhất `approvals_live_uq` chặn hai lượt sống cho một HĐ.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ApprovalRepo,
  ApprovalState,
  ContractRunRef,
  OpenOutcome,
} from "../application/approval.ports";
import { APPROVAL_DEFAULTS, type ApprovalSettings } from "../domain/approval-def.rules";
import type { FlowStep } from "../domain/approval-flow.types";
import { settingsRepo } from "./approval-settings.repo";

/** Trạng thái HĐ còn trong flow (chưa "Đã duyệt"/"Bị từ chối"/theo dõi). */
const OPEN = sql`('extracting', 'extract_failed', 'needs_review')`;
const LIVE = sql`('extracting', 'level1', 'level2')`;
const json = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

function runOfQ(tx: Tx, tid: string): ApprovalRepo["runOf"] {
  return async (id) => {
    const [r] = await tx.execute<{
      run_id: string | null;
      status: string;
      has_src: boolean;
      version: number;
    }>(sql`
      select run_id, status, version, (source_text is not null or file_id is not null) as has_src
      from contracts.contracts where id = ${id}::uuid and tenant_id = ${tid}::uuid`);
    return r
      ? ({
          runId: r.run_id,
          status: r.status,
          hasSource: r.has_src,
          version: Number(r.version),
        } as ContractRunRef)
      : null;
  };
}

type StateRow = {
  run_id: string | null;
  status: string;
  has_src: boolean;
  version: number;
  a_status: string | null;
  a_by: string | null;
  a_fb: string | null;
  a_mode: string | null;
  a_run: string | null;
  a_steps: unknown;
  deal: string | null;
  v: unknown;
  threshold: string | number | null;
};
const toState = (r: StateRow): ApprovalState => ({
  runId: r.run_id,
  status: r.status,
  hasSource: r.has_src,
  version: Number(r.version),
  approval:
    r.run_id && r.a_status
      ? {
          id: r.run_id,
          status: r.a_status,
          startedBy: r.a_by as string,
          feedback: r.a_fb,
          mode: r.a_mode ?? "machine",
          engineRunId: r.a_run,
          flowSteps: (json(r.a_steps) ?? null) as FlowStep[] | null,
        }
      : null,
  deal: r.deal,
  value: json(r.v),
  threshold: Number(r.threshold ?? APPROVAL_DEFAULTS.threshold),
});

function stateQ(tx: Tx, tid: string): ApprovalRepo["state"] {
  return async (id, o) => {
    const lock = o.lock ? sql`for update of c` : sql``;
    const [r] = await tx.execute<StateRow>(sql`
      select c.run_id, c.status, c.version, (c.source_text is not null or c.file_id is not null) as has_src,
        a.status as a_status, a.started_by as a_by, a.feedback as a_fb, a.mode as a_mode, a.engine_run_id as a_run, a.flow_steps as a_steps, c.deal,
        c.fields -> 'total_value' -> 'value' as v,
        (select s.threshold from contracts.approval_settings s where s.tenant_id = ${tid}::uuid) as threshold
      from contracts.contracts c
      left join contracts.approvals a on a.id = c.run_id and a.tenant_id = c.tenant_id
      where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid ${lock}`);
    return r ? toState(r) : null;
  };
}

/** Đua mở hai lượt cùng HĐ: chỉ mục duy nhất `approvals_live_uq` ném 23505 ⇒ `busy`. */
const isUniqueViolation = (e: unknown): boolean => {
  const o = e as { code?: string; cause?: { code?: string } } | null;
  return o?.code === "23505" || o?.cause?.code === "23505";
};

function openQ(tx: Tx, tid: string): ApprovalRepo["open"] {
  const run = openOnce(tx, tid);
  return (id, aid, actor, initial) =>
    run(id, aid, actor, initial).catch((e) => {
      if (isUniqueViolation(e)) return "busy" as const;
      throw e;
    });
}

function openOnce(tx: Tx, tid: string): ApprovalRepo["open"] {
  return async (id, aid, actor, initial): Promise<OpenOutcome> => {
    const [r] = await tx.execute<{ found: boolean; busy: boolean; opened: boolean }>(sql`with
      c as (select id, run_id from contracts.contracts where id = ${id}::uuid and tenant_id = ${tid}::uuid for update),
      live as (select a.id from contracts.approvals a join c on a.contract_id = c.id
        where a.tenant_id = ${tid}::uuid and a.status in ${LIVE}),
      ins as (insert into contracts.approvals (id, tenant_id, contract_id, status, started_by)
        select ${aid}::uuid, ${tid}::uuid, c.id, ${initial}, ${actor}::uuid from c
        where not exists (select 1 from live) returning id, contract_id),
      u as (update contracts.contracts t set run_id = ins.id, updated_at = now() from ins
        where t.id = ins.contract_id and t.tenant_id = ${tid}::uuid returning t.id),
      e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tid}::uuid, ins.contract_id, 'approval_started', ${actor}::uuid,
          jsonb_build_object('run_id', ins.id::text) from ins)
      select exists (select 1 from c) as found, exists (select 1 from live) as busy,
        exists (select 1 from u) as opened`);
    if (!r?.found) return "not_found";
    return r.opened ? "ok" : "busy";
  };
}

function toLevel2Q(tx: Tx, tid: string): ApprovalRepo["toLevel2"] {
  return async (aid, actor) => {
    const rows = await tx.execute<{
      id: string;
    }>(sql`update contracts.approvals set status = 'level2',
        level1_by = ${actor}::uuid, level1_at = now(), updated_at = now()
      where id = ${aid}::uuid and tenant_id = ${tid}::uuid and status = 'level1' returning id`);
    return rows.length > 0;
  };
}

function finalizeQ(tx: Tx, tid: string): ApprovalRepo["finalize"] {
  return async (id, runId, by, level2Passed) => {
    // Re-verify TOCTOU (D3-14): luật cấp 2 nằm TRONG điều kiện UPDATE (đánh giá lại trên hàng mới nhất sau khi chờ khoá hàng —
    // PATCH giữ `FOR UPDATE` cùng hàng). Cột sinh `value` (bigint) ≡ `needsLevel2`: trống / âm / ≥ ngưỡng ⇒ cần cấp 2.
    // Review B #26 · `level2Passed` của caller không đủ: câu UPDATE tự kiểm lượt đang ở `level2` và người quyết ≠ người bắt đầu.
    const rows = await tx.execute<{ id: string }>(sql`with u as (
        update contracts.contracts c set status = 'active', confirmed_at = now(), confirmed_by = ${by}::uuid,
          version = c.version + 1, updated_at = now()
        where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid and c.run_id = ${runId}::uuid
          and c.status = 'needs_review'
          and ((${level2Passed}::boolean and exists (select 1 from contracts.approvals y
              where y.id = ${runId}::uuid and y.tenant_id = ${tid}::uuid and y.status = 'level2'
                and y.started_by <> ${by}::uuid))
            or (c.value is not null and c.value >= 0 and c.value < coalesce(
            (select s.threshold from contracts.approval_settings s where s.tenant_id = ${tid}::uuid),
            ${APPROVAL_DEFAULTS.threshold}::bigint)))
        returning c.id),
      a as (update contracts.approvals x set status = 'done', decided_by = ${by}::uuid, decided_at = now(),
          level1_by = coalesce(x.level1_by, ${by}::uuid), level1_at = coalesce(x.level1_at, now()), updated_at = now()
        from u where x.id = ${runId}::uuid and x.tenant_id = ${tid}::uuid and x.status in ('level1', 'level2')),
      e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tid}::uuid, u.id, 'approved', ${by}::uuid, jsonb_build_object('run_id', ${runId}::text) from u)
      select id from u`);
    return rows.length > 0;
  };
}

function rejectQ(tx: Tx, tid: string): ApprovalRepo["markRejected"] {
  return async (id, runId, e) => {
    const rows = await tx.execute<{ id: string }>(sql`with u as (
        update contracts.contracts set status = 'rejected', version = version + 1, updated_at = now()
        where id = ${id}::uuid and tenant_id = ${tid}::uuid and run_id = ${runId}::uuid and status in ${OPEN}
        returning id),
      a as (update contracts.approvals x set status = ${e.kind}, decided_by = ${e.actor}::uuid, decided_at = now(),
          feedback = ${e.feedback}, updated_at = now()
        from u where x.id = ${runId}::uuid and x.tenant_id = ${tid}::uuid and x.status in ${LIVE}),
      ev as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tid}::uuid, u.id, ${e.kind}, ${e.actor}::uuid,
          jsonb_build_object('run_id', ${runId}::text, 'feedback', ${e.feedback}::text) from u)
      select id from u`);
    return rows.length > 0;
  };
}

function markQ(tx: Tx, tid: string): ApprovalRepo["markExtracting"] {
  return async (id, runId) => {
    const rows = await tx.execute<{ id: string }>(sql`with u as (
        update contracts.contracts set status = 'extracting', error = null, version = version + 1, updated_at = now()
        where id = ${id}::uuid and tenant_id = ${tid}::uuid and run_id = ${runId}::uuid
          and status in ('needs_review', 'extract_failed') returning id),
      a as (update contracts.approvals x set status = 'extracting', queued_at = now(), updated_at = now(),
          mode = 'machine', engine_run_id = null, pending_links = null
        from u where x.id = ${runId}::uuid and x.tenant_id = ${tid}::uuid and x.status in ('level1', 'level2'))
      select id from u`);
    return rows.length > 0;
  };
}

function afterQ(tx: Tx, tid: string): ApprovalRepo["afterExtraction"] {
  return async (id, runId) => {
    const [r] = await tx.execute<{ status: string }>(sql`update contracts.approvals x set
        status = case c.status when 'needs_review' then 'level1' else 'failed' end, updated_at = now()
      from contracts.contracts c
      where x.id = ${runId}::uuid and x.tenant_id = ${tid}::uuid and x.status = 'extracting'
        and c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid and c.run_id = x.id
        and c.status in ('needs_review', 'extract_failed')
      returning x.status`);
    return r?.status ?? null;
  };
}

/** Review B #7 · worker bắt đầu lượt đọc: lượt hết "xếp hàng" (`queued_at = null`) + HĐ `updated_at = now()` ⇒ STALE tính từ
 *  lúc chạy (không tính thời gian chờ hàng). Không đổi `version` (không phải sửa nội dung). */
function startedQ(tx: Tx, tid: string): ApprovalRepo["markStarted"] {
  return async (id, runId) => {
    const rows = await tx.execute<{ id: string }>(sql`with a as (
        update contracts.approvals set queued_at = null, updated_at = now()
        where id = ${runId}::uuid and tenant_id = ${tid}::uuid and status = 'extracting' returning id)
      update contracts.contracts c set updated_at = now() from a
      where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid and c.run_id = a.id and c.status = 'extracting'
      returning c.id`);
    return rows.length > 0;
  };
}

function statusQ(tx: Tx, tid: string): ApprovalRepo["statusOf"] {
  return async (runId) => {
    const [r] = await tx.execute<{ status: string }>(sql`select status from contracts.approvals
      where id = ${runId}::uuid and tenant_id = ${tid}::uuid`);
    return r?.status ?? null;
  };
}

export function approvalRepo(tx: Tx, tenantId: string): ApprovalRepo {
  const s = settingsRepo(tx, tenantId);
  return {
    runOf: runOfQ(tx, tenantId),
    state: stateQ(tx, tenantId),
    open: openQ(tx, tenantId),
    toLevel2: toLevel2Q(tx, tenantId),
    finalize: finalizeQ(tx, tenantId),
    markRejected: rejectQ(tx, tenantId),
    markExtracting: markQ(tx, tenantId),
    afterExtraction: afterQ(tx, tenantId),
    markStarted: startedQ(tx, tenantId),
    statusOf: statusQ(tx, tenantId),
    settings: s.settings,
    saveSettings: s.saveSettings,
  };
}
export type { ApprovalSettings };
