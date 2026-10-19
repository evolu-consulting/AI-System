// HD-FR-31…37 · D3-03 · D3-09 · HD3 plan §2: SQL flow duyệt trong tx `PackUow` (role `contracts_rw`, RLS FORCE) + `tenant_id`
// tường minh. Mỗi hàm MỘT câu văn bản hằng; ghi có điều kiện `run_id` + trạng thái (idempotent, nhiều instance an toàn).
// Vòng quét: lô qua MỘT tham số JSON (`jsonb_to_recordset`) — số câu không phụ thuộc số hàng.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ApprovalRepo,
  BeginExtract,
  ContractRunRef,
  FlowRow,
  SweepRepo,
} from "../application/approval.ports";
import { APPROVAL_DEFAULTS, type ApprovalSettings } from "../domain/approval-def.rules";

/** Trạng thái còn trong flow (chưa "Đã duyệt"/"Bị từ chối"/theo dõi). */
const OPEN = sql`('extracting', 'extract_failed', 'needs_review')`;

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

function attachQ(tx: Tx, tid: string): ApprovalRepo["attachRun"] {
  return async (id, runId, prev, actor) => {
    const rows = await tx.execute<{ id: string }>(sql`with u as (
        update contracts.contracts set run_id = ${runId}::uuid, updated_at = now()
        where id = ${id}::uuid and tenant_id = ${tid}::uuid and status in ${OPEN}
          and run_id is not distinct from ${prev}::uuid
        returning id),
      e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tid}::uuid, u.id, 'approval_started', ${actor}::uuid,
          jsonb_build_object('run_id', ${runId}::text) from u)
      select id from u`);
    return rows.length > 0;
  };
}

function beginQ(tx: Tx, tid: string): ApprovalRepo["beginExtract"] {
  return async (id, runId) => {
    const [r] = await tx.execute<{ src: boolean; upd: boolean }>(sql`with c as (
        select id, (source_text is not null or file_id is not null) as src from contracts.contracts
        where id = ${id}::uuid and tenant_id = ${tid}::uuid and run_id = ${runId}::uuid and status in ${OPEN}
        for update),
      u as (update contracts.contracts t set status = 'extracting', error = null,
          version = t.version + case when t.status = 'extracting' then 0 else 1 end, updated_at = now()
        from c where t.id = c.id and t.tenant_id = ${tid}::uuid and c.src returning t.id)
      select c.src, exists (select 1 from u) as upd from c`);
    const out: BeginExtract = !r ? "denied" : r.src ? "extract" : "skip";
    return out;
  };
}

function valueQ(tx: Tx, tid: string): ApprovalRepo["valueOf"] {
  return async (id, runId) => {
    const [r] = await tx.execute<{ v: unknown }>(sql`select fields -> 'total_value' -> 'value' as v
      from contracts.contracts where id = ${id}::uuid and tenant_id = ${tid}::uuid and run_id = ${runId}::uuid`);
    if (!r) return undefined;
    const v = typeof r.v === "string" ? JSON.parse(r.v) : r.v;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
}

function finalizeQ(tx: Tx, tid: string): ApprovalRepo["finalize"] {
  return async (id, runId, by) => {
    const rows = await tx.execute<{ id: string }>(sql`with u as (
        update contracts.contracts set status = 'active', confirmed_at = now(), confirmed_by = ${by}::uuid,
          version = version + 1, updated_at = now()
        where id = ${id}::uuid and tenant_id = ${tid}::uuid and run_id = ${runId}::uuid and status = 'needs_review'
        returning id),
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
      ev as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tid}::uuid, u.id, ${e.kind}, ${e.actor}::uuid,
          jsonb_build_object('run_id', ${runId}::text, 'feedback', ${e.feedback}::text) from u)
      select id from u`);
    return rows.length > 0;
  };
}

type SettingsRow = { threshold: string | number; l1: string; l2: string };
const toSettings = (r: SettingsRow | undefined): ApprovalSettings =>
  r
    ? { threshold: Number(r.threshold), level1GroupKey: r.l1, level2GroupKey: r.l2 }
    : { ...APPROVAL_DEFAULTS };

function settingsQ(tx: Tx, tid: string): ApprovalRepo["settings"] {
  return async () => {
    const [r] = await tx.execute<SettingsRow>(sql`select threshold, level1_group_key as l1,
      level2_group_key as l2 from contracts.approval_settings where tenant_id = ${tid}::uuid`);
    return toSettings(r);
  };
}

function saveSettingsQ(tx: Tx, tid: string): ApprovalRepo["saveSettings"] {
  return async (s, actor) => {
    const [r] = await tx.execute<SettingsRow>(sql`insert into contracts.approval_settings
        (tenant_id, threshold, level1_group_key, level2_group_key, updated_by)
      values (${tid}::uuid, ${s.threshold}::bigint, ${s.level1GroupKey}, ${s.level2GroupKey}, ${actor}::uuid)
      on conflict (tenant_id) do update set threshold = excluded.threshold,
        level1_group_key = excluded.level1_group_key, level2_group_key = excluded.level2_group_key,
        updated_by = excluded.updated_by, updated_at = now()
      returning threshold, level1_group_key as l1, level2_group_key as l2`);
    return toSettings(r);
  };
}

export function approvalRepo(tx: Tx, tenantId: string): ApprovalRepo {
  return {
    runOf: runOfQ(tx, tenantId),
    attachRun: attachQ(tx, tenantId),
    beginExtract: beginQ(tx, tenantId),
    valueOf: valueQ(tx, tenantId),
    finalize: finalizeQ(tx, tenantId),
    markRejected: rejectQ(tx, tenantId),
    settings: settingsQ(tx, tenantId),
    saveSettings: saveSettingsQ(tx, tenantId),
  };
}

/** Vòng quét (scope system của tenant). `contracts_status_idx (tenant_id, status)` phục vụ cả hai nhánh. */
export function sweepRepo(tx: Tx, tid: string): SweepRepo {
  return {
    async inFlow(staleMinutes, limit) {
      const rows = await tx.execute<{
        id: string;
        run_id: string | null;
        status: string;
        stale: boolean;
      }>(sql`
        select id, run_id, status, (run_id is null and status = 'extracting'
          and updated_at < now() - make_interval(mins => ${staleMinutes}::int)) as stale
        from contracts.contracts
        where tenant_id = ${tid}::uuid and status in ${OPEN}
          and (run_id is not null or (status = 'extracting'
            and updated_at < now() - make_interval(mins => ${staleMinutes}::int)))
        order by updated_at limit ${limit}::int`);
      return rows.map(
        (r): FlowRow => ({ id: r.id, runId: r.run_id, status: r.status, stale: r.stale }),
      );
    },
    async close(rows) {
      if (rows.length === 0) return 0;
      const out = await tx.execute<{ id: string }>(sql`with x as (
          select * from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
            as x (id uuid, "runId" uuid, action text, feedback text)),
        u as (update contracts.contracts c set
            status = case when x.action = 'stale' then 'extract_failed' else 'rejected' end,
            error = case when x.action = 'stale' then 'STALE' else c.error end,
            version = c.version + 1, updated_at = now()
          from x where c.id = x.id and c.tenant_id = ${tid}::uuid
            and c.run_id is not distinct from x."runId"
            and (case when x.action = 'stale' then c.status = 'extracting' else c.status in ${OPEN} end)
          returning c.id, x.action, x.feedback, x."runId"),
        e as (insert into contracts.contract_events (tenant_id, contract_id, type, data)
          select ${tid}::uuid, u.id, case when u.action = 'stale' then 'extract_failed' else u.action end,
            jsonb_build_object('run_id', u."runId"::text, 'feedback', u.feedback,
              'code', case when u.action = 'stale' then 'STALE' end) from u)
        select id from u`);
      return out.length;
    },
  };
}
