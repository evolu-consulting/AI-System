// contract-flow S3a · SQL lượt duyệt chạy trên engine trong tx `PackUow` (role `contracts_rw`, RLS FORCE) + `tenant_id` tường minh.
// Mọi câu đọc/ghi theo run lọc `engine_run_id = $run AND tenant_id = $tid AND mode = 'engine'` và HĐ `run_id = lượt` ⇒ tool
// của run khác / tenant khác chạm 0 hàng. Mỗi hàm MỘT câu văn bản hằng.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ApprovalEngineRepo,
  EngineRunRow,
  EngineStartRow,
} from "../application/approval-engine.ports";
import type { FlowStep } from "../domain/approval-flow.types";

const json = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

type RunRow = {
  contract_id: string;
  approval_id: string;
  a_status: string;
  c_status: string;
  deal: string | null;
  v: unknown;
  flow_steps: unknown;
  pending_links: unknown;
};
const toRun = (r: RunRow): EngineRunRow => ({
  contractId: r.contract_id,
  approvalId: r.approval_id,
  approvalStatus: r.a_status,
  contractStatus: r.c_status,
  deal: r.deal,
  totalValue: json(r.v),
  flowSteps: (json(r.flow_steps) ?? []) as FlowStep[],
  pendingLinks: (json(r.pending_links) ?? null) as unknown[] | null,
});

function byRunQ(tx: Tx, tid: string): ApprovalEngineRepo["byRun"] {
  return async (runId, o) => {
    const lock = o.lock ? sql`for update of c` : sql``;
    const [r] = await tx.execute<RunRow>(sql`
      select c.id as contract_id, a.id as approval_id, a.status as a_status, c.status as c_status, c.deal,
        c.fields -> 'total_value' -> 'value' as v, a.flow_steps, a.pending_links
      from contracts.approvals a
      join contracts.contracts c on c.id = a.contract_id and c.tenant_id = a.tenant_id and c.run_id = a.id
      where a.engine_run_id = ${runId}::uuid and a.tenant_id = ${tid}::uuid and a.mode = 'engine' ${lock}`);
    return r ? toRun(r) : null;
  };
}

function startStateQ(tx: Tx, tid: string): ApprovalEngineRepo["startState"] {
  return async (id) => {
    const [r] = await tx.execute<{
      approval_id: string | null;
      a_status: string | null;
      mode: string | null;
      engine_run_id: string | null;
      started_by: string | null;
    }>(sql`
      select a.id as approval_id, a.status as a_status, a.mode, a.engine_run_id, a.started_by
      from contracts.contracts c
      left join contracts.approvals a on a.id = c.run_id and a.tenant_id = c.tenant_id
      where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid`);
    if (!r) return null;
    const out: EngineStartRow = {
      approvalId: r.approval_id,
      approvalStatus: r.a_status,
      mode: r.mode,
      engineRunId: r.engine_run_id,
      startedBy: r.started_by,
    };
    return out;
  };
}

function attachQ(tx: Tx, tid: string): ApprovalEngineRepo["attach"] {
  return async (id, aid, a) => {
    // Khoá hàng HĐ TRƯỚC khi ghi (cùng thứ tự với `decideInTx` của máy cũ: HĐ rồi lượt) ⇒ không đua máy cũ vs gắn run.
    const rep = a.replaces ?? null;
    const rows = await tx.execute<{ id: string }>(sql`with c as (
        select id from contracts.contracts
        where id = ${id}::uuid and tenant_id = ${tid}::uuid and run_id = ${aid}::uuid for update)
      update contracts.approvals x
      set mode = 'engine', engine_run_id = ${a.runId}::uuid, flow_version = ${a.version}::int,
        flow_steps = ${JSON.stringify(a.steps)}::jsonb, feedback = null, updated_at = now()
      from c
      where x.id = ${aid}::uuid and x.tenant_id = ${tid}::uuid and x.contract_id = ${id}::uuid
        and x.status = 'level1' and c.id = x.contract_id
        and ((${rep}::uuid is null and x.mode = 'machine' and x.engine_run_id is null)
          or (${rep}::uuid is not null and x.mode = 'engine' and x.engine_run_id = ${rep}::uuid))
      returning x.id`);
    return rows.length > 0;
  };
}

function finalizeQ(tx: Tx, tid: string): ApprovalEngineRepo["finalize"] {
  return async (id, aid, runId, by) => {
    const rows = await tx.execute<{ id: string }>(sql`with a0 as (
        select y.id from contracts.approvals y
        where y.id = ${aid}::uuid and y.tenant_id = ${tid}::uuid and y.engine_run_id = ${runId}::uuid
          and y.mode = 'engine' and y.status = 'level1'),
      u as (update contracts.contracts c set status = 'active', confirmed_at = now(), confirmed_by = ${by}::uuid,
          version = c.version + 1, updated_at = now()
        from a0 where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid and c.run_id = a0.id
          and c.status = 'needs_review'
        returning c.id),
      a as (update contracts.approvals x set status = 'done', decided_by = ${by}::uuid, decided_at = now(),
          updated_at = now()
        from u where x.id = ${aid}::uuid and x.tenant_id = ${tid}::uuid),
      e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tid}::uuid, u.id, 'approved', ${by}::uuid,
          jsonb_build_object('run_id', ${aid}::text, 'engine_run_id', ${runId}::text) from u)
      select id from u`);
    return rows.length > 0;
  };
}

function pendingQ(tx: Tx, tid: string): ApprovalEngineRepo["setPendingLinks"] {
  return async (aid, runId, links) => {
    const rows = await tx.execute<{ id: string }>(sql`update contracts.approvals set
        pending_links = ${links === null ? null : JSON.stringify(links)}::jsonb, updated_at = now()
      where id = ${aid}::uuid and tenant_id = ${tid}::uuid and engine_run_id = ${runId}::uuid
        and mode = 'engine' and status = 'level1' returning id`);
    return rows.length > 0;
  };
}

function labelsQ(tx: Tx, tid: string): ApprovalEngineRepo["labels"] {
  return async (ids) => {
    if (ids.length === 0) return [];
    const rows = await tx.execute<{ id: string; number: string | null; title: string | null }>(sql`
      select c.id, c.number, c.title from contracts.contracts c
      where c.tenant_id = ${tid}::uuid and c.id = any(${`{${ids.join(",")}}`}::uuid[])`);
    return [...rows];
  };
}

function difyFactsQ(tx: Tx, tid: string): ApprovalEngineRepo["difyFacts"] {
  return async (id) => {
    const [r] = await tx.execute<{
      title: string | null;
      deal: string | null;
      v: unknown;
      partner: string | null;
    }>(sql`
      select c.title, c.deal, c.fields -> 'total_value' -> 'value' as v,
        case c.deal when 'sell' then c.buyer when 'buy' then c.seller
          else concat_ws(' / ', c.seller, c.buyer) end as partner
      from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid`);
    return r
      ? { title: r.title ?? "", deal: r.deal, totalValue: json(r.v), partner: r.partner ?? "" }
      : null;
  };
}

export function approvalEngineRepo(tx: Tx, tenantId: string): ApprovalEngineRepo {
  return {
    difyFacts: difyFactsQ(tx, tenantId),
    setPendingLinks: pendingQ(tx, tenantId),
    labels: labelsQ(tx, tenantId),
    byRun: byRunQ(tx, tenantId),
    startState: startStateQ(tx, tenantId),
    attach: attachQ(tx, tenantId),
    finalize: finalizeQ(tx, tenantId),
  };
}
