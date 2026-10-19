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
        select id, (source_text is not null or file_id is not null)
          and status in ('extracting', 'extract_failed') as src from contracts.contracts
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

/** "Đọc lại" (redo ở cấp 1): đánh dấu `extracting` TRƯỚC khi engine chạy lại stage trích (`to`), hoặc trả về (`needs_review`)
 *  khi engine từ chối quyết. Chỉ HĐ đang giữ run đó. */
function markQ(tx: Tx, tid: string): ApprovalRepo["markExtracting"] {
  return async (id, runId, on) => {
    const from = on ? "needs_review" : "extracting";
    const to = on ? "extracting" : "needs_review";
    const rows = await tx.execute<{
      id: string;
    }>(sql`update contracts.contracts set status = ${to}, updated_at = now()
      where id = ${id}::uuid and tenant_id = ${tid}::uuid and run_id = ${runId}::uuid and status = ${from}
      returning id`);
    return rows.length > 0;
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
  return async (id, runId, by, level2Passed) => {
    // Re-verify TOCTOU: luật cấp 2 nằm TRONG điều kiện UPDATE (đánh giá lại trên hàng mới nhất sau khi chờ khoá hàng — PATCH
    // giữ `FOR UPDATE` cùng hàng) ⇒ không có cửa sổ giữa đọc giá trị và ghi "Đã duyệt". Cột sinh `value` (bigint) ≡ `needsLevel2`:
    // trống / không phải số nguyên / âm / ≥ ngưỡng ⇒ cần cấp 2.
    const rows = await tx.execute<{ id: string }>(sql`with u as (
        update contracts.contracts c set status = 'active', confirmed_at = now(), confirmed_by = ${by}::uuid,
          version = c.version + 1, updated_at = now()
        where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid and c.run_id = ${runId}::uuid
          and c.status = 'needs_review'
          and (${level2Passed}::boolean or (c.value is not null and c.value >= 0 and c.value < coalesce(
            (select s.threshold from contracts.approval_settings s where s.tenant_id = ${tid}::uuid),
            ${APPROVAL_DEFAULTS.threshold}::bigint)))
        returning c.id),
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

const DEFAULTS_JSON = JSON.stringify({
  threshold: APPROVAL_DEFAULTS.threshold,
  level1_group_key: APPROVAL_DEFAULTS.level1GroupKey,
  level2_group_key: APPROVAL_DEFAULTS.level2GroupKey,
});

/** Upsert + nhật ký trước/sau (review M1) trong MỘT câu: `old` đọc ảnh trước khi ghi; vắng hàng ⇒ trước = mặc định. */
function saveSettingsQ(tx: Tx, tid: string): ApprovalRepo["saveSettings"] {
  return async (s, actor) => {
    const [r] = await tx.execute<SettingsRow>(sql`with old as (
        select jsonb_build_object('threshold', threshold, 'level1_group_key', level1_group_key,
          'level2_group_key', level2_group_key) as v
        from contracts.approval_settings where tenant_id = ${tid}::uuid),
      up as (insert into contracts.approval_settings
          (tenant_id, threshold, level1_group_key, level2_group_key, updated_by)
        values (${tid}::uuid, ${s.threshold}::bigint, ${s.level1GroupKey}, ${s.level2GroupKey}, ${actor}::uuid)
        on conflict (tenant_id) do update set threshold = excluded.threshold,
          level1_group_key = excluded.level1_group_key, level2_group_key = excluded.level2_group_key,
          updated_by = excluded.updated_by, updated_at = now()
        returning threshold, level1_group_key as l1, level2_group_key as l2),
      au as (insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after)
        select ${tid}::uuid, ${actor}::uuid, coalesce((select v from old), ${DEFAULTS_JSON}::jsonb),
          jsonb_build_object('threshold', up.threshold, 'level1_group_key', up.l1, 'level2_group_key', up.l2)
        from up)
      select threshold, l1, l2 from up`);
    return toSettings(r);
  };
}
export function approvalRepo(tx: Tx, tenantId: string): ApprovalRepo {
  return {
    runOf: runOfQ(tx, tenantId),
    attachRun: attachQ(tx, tenantId),
    beginExtract: beginQ(tx, tenantId),
    markExtracting: markQ(tx, tenantId),
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
    async inFlow(staleMinutes, limit, after) {
      const rows = await tx.execute<{
        id: string;
        run_id: string | null;
        status: string;
        stale: boolean;
        updated_at: string | Date;
      }>(sql`
        select id, run_id, status, updated_at, (run_id is null and status = 'extracting'
          and updated_at < now() - make_interval(mins => ${staleMinutes}::int)) as stale
        from contracts.contracts
        where tenant_id = ${tid}::uuid and status in ${OPEN}
          and (run_id is not null or (status = 'extracting'
            and updated_at < now() - make_interval(mins => ${staleMinutes}::int)))
          and (${after?.at ?? null}::timestamptz is null
            or (updated_at, id) > (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
        order by updated_at, id limit ${limit}::int`);
      return rows.map(
        (r): FlowRow => ({
          id: r.id,
          runId: r.run_id,
          status: r.status,
          stale: r.stale,
          updatedAt: new Date(r.updated_at).toISOString(),
        }),
      );
    },
    async orphanReopens(staleMinutes, limit) {
      const rows = await tx.execute<{
        id: string;
        actor: string;
      }>(sql`select c.id, e.actor_user_id as actor
        from contracts.contracts c
        join lateral (select ev.type, ev.actor_user_id, ev.data from contracts.contract_events ev
          where ev.contract_id = c.id and ev.tenant_id = c.tenant_id
            and ev.type in ('field_edited', 'approval_started')
          order by ev.id desc limit 1) e on true
        where c.tenant_id = ${tid}::uuid and c.status = 'needs_review' and c.run_id is null
          and c.updated_at < now() - make_interval(mins => ${staleMinutes}::int)
          and e.type = 'field_edited' and (e.data->>'approval_reopened')::boolean is true
          and e.actor_user_id is not null
        order by c.updated_at, c.id limit ${limit}::int`);
      return [...rows];
    },
    async close(rows) {
      if (rows.length === 0) return 0;
      const out = await tx.execute<{ id: string }>(sql`with x as (
          select * from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
            as x (id uuid, "runId" uuid, action text, feedback text)),
        u as (update contracts.contracts c set
            status = case when x.action in ('stale', 'failed') then 'extract_failed' else 'rejected' end,
            error = case x.action when 'stale' then 'STALE' when 'failed' then 'FLOW_FAILED' else c.error end,
            version = c.version + 1, updated_at = now()
          from x where c.id = x.id and c.tenant_id = ${tid}::uuid
            and c.run_id is not distinct from x."runId"
            and (case when x.action = 'stale' then c.status = 'extracting' else c.status in ${OPEN} end)
          returning c.id, x.action, x.feedback, x."runId"),
        e as (insert into contracts.contract_events (tenant_id, contract_id, type, data)
          select ${tid}::uuid, u.id, case when u.action in ('stale', 'failed') then 'extract_failed' else u.action end,
            jsonb_build_object('run_id', u."runId"::text, 'feedback', u.feedback,
              'code', case u.action when 'stale' then 'STALE' when 'failed' then 'FLOW_FAILED' end) from u)
        select id from u`);
      return out.length;
    },
  };
}
