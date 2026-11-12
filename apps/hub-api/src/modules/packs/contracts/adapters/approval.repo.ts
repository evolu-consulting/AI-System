// HD-FR-31…37 · D3-13/D3-14 · M3-decouple: SQL máy trạng thái duyệt trong tx `PackUow` (role `contracts_rw`, RLS FORCE) +
// `tenant_id` tường minh. Mỗi hàm MỘT câu văn bản hằng; ghi có điều kiện `run_id` (= id lượt duyệt) + trạng thái (idempotent,
// nhiều instance an toàn). Chỉ mục duy nhất `approvals_live_uq` chặn hai lượt sống cho một HĐ.
// CR-127 Z1 · LƯU Ý: `mode = 'machine'` + `extracting` còn lại CHỈ là bản ghi theo dõi lượt AI ĐỌC (hợp lệ, không phải máy duyệt 2 bước cũ — đã gỡ); lượt duyệt thật là `mode = 'engine'`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ApprovalRepo,
  ApprovalState,
  ContractRunRef,
  OpenOutcome,
} from "../application/approval.ports";
import { ESIGN_SENDING_STALE_MIN } from "../application/esign-flow.usecase";
import { APPROVAL_DEFAULTS, type ApprovalSettings } from "../domain/approval-def.rules";
import type { FlowStep } from "../domain/approval-flow.types";
import { OVERRIDE_EVENT } from "../domain/approval-owner.rules";
import { settingsRepo } from "./approval-settings.repo";
import { contractStateRepo } from "./contract-state.repo";

const LIVE = sql`('extracting', 'level1', 'level2')`;
const json = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

/** CR-109 · cờ tx-local cho policy `contracts_visible_upd` (0070): người duyệt ngoài cây chỉ khoá/ghi hàng HĐ trong lệnh DUYỆT
 *  lượt ENGINE (khoá trạng thái khi quyết, Từ chối, khoá/ghi Đã duyệt của tool) — không qua sửa trường, Trích lại, Đọc lại.
 *  Gọi NGAY TRƯỚC câu khoá/ghi, cùng tx. */
export async function approvalWrite(tx: Tx): Promise<void> {
  await tx.execute(sql`select set_config('app.approval_write', '1', true)`);
}
/** Mốc giờ ⇒ ISO UTC (chuỗi, không phụ thuộc kiểu trả của driver). */
const ISO = (col: string) =>
  sql.raw(`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

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
  a_es?: string | null;
  a_er?: string | null;
  a_est?: boolean | null;
  a_eat?: string | null;
  a_erm?: string | null;
  a_ovr?: string[] | null;
  a_upd?: string | null;
  owner?: string | null;
  src?: string | null;
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
          esignStatus: r.a_es ?? null,
          esignReason: r.a_er ?? null,
          esignStale: r.a_est === true,
          esignAt: r.a_eat ?? null,
          esignRemindedAt: r.a_erm ?? null,
          overrideTasks: r.a_ovr ?? [],
          updatedAt: r.a_upd ?? null,
        }
      : null,
  owner: r.owner ?? null,
  source: r.src ?? null,
  deal: r.deal,
  value: json(r.v),
  threshold: Number(r.threshold ?? APPROVAL_DEFAULTS.threshold),
});

function stateQ(tx: Tx, tid: string): ApprovalRepo["state"] {
  return async (id, o) => {
    const lock = o.lock ? sql`for update of c` : sql``;
    if (o.lock && o.approval === true) await approvalWrite(tx);
    const [r] = await tx.execute<StateRow>(sql`
      select c.run_id, c.status, c.version, (c.source_text is not null or c.file_id is not null) as has_src,
        a.status as a_status, a.started_by as a_by, a.feedback as a_fb, a.mode as a_mode, a.engine_run_id as a_run, a.flow_steps as a_steps, c.deal,
        a.esign_status as a_es, a.esign_reason as a_er, c.owner_user_id as owner, c.source as src,
        (a.esign_status = 'sending' and a.esign_at < now() - make_interval(mins => ${ESIGN_SENDING_STALE_MIN}::int)) as a_est,
        ${ISO("a.esign_at")} as a_eat, ${ISO("a.esign_reminded_at")} as a_erm, ${ISO("a.updated_at")} as a_upd,
        (select array_agg((e.data->>'task_id') || ':' || e.actor_user_id::text) from contracts.contract_events e
          where e.contract_id = c.id and e.tenant_id = c.tenant_id and e.type = ${OVERRIDE_EVENT}
            and e.data->>'run_id' = a.id::text) as a_ovr,
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

/** Từ chối / huỷ lượt ENGINE ⇒ HĐ `processing` → `reject` qua CỔNG (`flow_rejected`) + lượt `rejected`/`cancelled` + event. Chỉ khi HĐ còn giữ lượt. */
function rejectQ(tx: Tx, tid: string): ApprovalRepo["markRejected"] {
  return async (id, runId, e, o) => {
    if (o?.reviewer === true) await approvalWrite(tx);
    const g = await contractStateRepo(tx, tid).applyTransition({
      contractId: id,
      ev: "flow_rejected",
      actorId: e.actor,
      reason: e.feedback,
      runId,
    });
    if (!g.ok) return false;
    await tx.execute(sql`with a as (update contracts.approvals x set status = ${e.kind}, decided_by = ${e.actor}::uuid,
          decided_at = now(), feedback = ${e.feedback}, updated_at = now()
        where x.id = ${runId}::uuid and x.tenant_id = ${tid}::uuid and x.status in ${LIVE})
      insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      values (${tid}::uuid, ${id}::uuid, ${e.kind}, ${e.actor}::uuid,
        jsonb_build_object('run_id', ${runId}::text, 'feedback', ${e.feedback}::text))`);
    return true;
  };
}

/** "Trích lại" ở lượt engine đang mở: HĐ `processing` → `draft` qua CỔNG (`flow_cancelled`), `extract_state = 'reading'`, lượt → `extracting` (lượt đọc). */
function markQ(tx: Tx, tid: string): ApprovalRepo["markExtracting"] {
  return async (id, runId) => {
    const o = await contractStateRepo(tx, tid).applyTransition({
      contractId: id,
      ev: "flow_cancelled",
      actorId: null,
      reason: "Trích lại",
      runId,
    });
    if (!o.ok) return false;
    const rows = await tx.execute<{ id: string }>(sql`update contracts.contracts
      set extract_state = 'reading', error = null, version = version + 1, updated_at = now()
      where id = ${id}::uuid and tenant_id = ${tid}::uuid and status = 'draft' and run_id = ${runId}::uuid
      returning id`);
    if (rows.length === 0) return false;
    await tx.execute(sql`update contracts.approvals x set status = 'extracting', queued_at = now(), updated_at = now(),
        mode = 'machine', engine_run_id = null, pending_links = null
      where x.id = ${runId}::uuid and x.tenant_id = ${tid}::uuid and x.status in ('level1', 'level2')`);
    return true;
  };
}

/** CR-127 Z1 · đọc xong ⇒ KHÔNG mở cấp 1 (HĐ là nháp chờ rà soát, vào quy trình qua "Gửi" — K3): lượt (chỉ để theo dõi lượt đọc) đóng
 *  `cancelled` và HĐ bỏ `run_id` ⇒ thẻ duyệt rỗng (bước = null), trang dùng "Xác nhận và lưu" (atomic-confirm). */
function afterQ(tx: Tx, tid: string): ApprovalRepo["afterExtraction"] {
  return async (id, runId) => {
    const [r] = await tx.execute<{ status: string }>(sql`with
      x as (update contracts.approvals x set updated_at = now(), queued_at = null,
          status = case when c.extract_state = 'failed' then 'failed'
            else 'cancelled' end
        from contracts.contracts c
        where x.id = ${runId}::uuid and x.tenant_id = ${tid}::uuid and x.status = 'extracting'
          and c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid and c.run_id = x.id
          and c.status = 'draft' and c.extract_state in ('ready', 'failed')
        returning x.id, x.status),
      u as (update contracts.contracts c set run_id = null from x
        where x.status = 'cancelled' and c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid and c.run_id = x.id)
      select status from x`);
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
      where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid and c.run_id = a.id and c.extract_state = 'reading'
      returning c.id`);
    return rows.length > 0;
  };
}

export function approvalRepo(tx: Tx, tenantId: string): ApprovalRepo {
  const s = settingsRepo(tx, tenantId);
  return {
    runOf: runOfQ(tx, tenantId),
    state: stateQ(tx, tenantId),
    open: openQ(tx, tenantId),
    markRejected: rejectQ(tx, tenantId),
    markExtracting: markQ(tx, tenantId),
    afterExtraction: afterQ(tx, tenantId),
    markStarted: startedQ(tx, tenantId),
    settings: s.settings,
    saveSettings: s.saveSettings,
  };
}
export type { ApprovalSettings };
