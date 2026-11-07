// CR-122 · A1 · FLOW2-FR-12/15/18/19 · SQL của gói Hợp đồng cho flow theo sự kiện. Mỗi hàm MỘT câu văn bản hằng + `tenant_id` tường minh
// (Luật 4c); không SQL theo hàng.
// - `emit*`: ghi `hub.flow_events` qua hàm SECURITY DEFINER `hub.emit_flow_event` (hub 0109) CÙNG tx bản ghi (role `contracts_rw` không
//   ghi được bảng). Facts dựng NGAY TRONG câu từ hàng HĐ (không thêm vòng đọc). Trùng `(tenant_id, event_id)` ⇒ không ghi.
// - `readFacts`: dữ kiện HIỆN TẠI cho `FactsReader` (node Nếu), lọc `tenant_id`; không thấy ⇒ null (không lộ tồn tại).
// - `applyOutcome`: việc của `OutcomeHandler` TRONG tx engine. Tx engine chạy role hub ⇒ `withPackRoleInTx` đổi sang role gói + tenant đúng
//   cửa sổ ghi rồi TRẢ LẠI role/biến cũ (engine còn ghi hub.* sau đó). Idempotent theo `(runId, outcome)`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import {
  type OutcomeInput,
  type OutcomeResult,
  shadowEmit,
  withPackRoleInTx,
} from "../../kit/public";
import { type ContractFlowRepo, FLOW_STARTING } from "../application/contract-flow.ports";
import { FLOW_START_STALE_MS } from "../domain/approval-engine-card.rules";
import {
  APPROVAL_STATUS_OF,
  CONTRACTS_PACK,
  type ContractOutcome,
  contractEventId,
  EV_APPROVED,
} from "../domain/contract-flow-events.rules";
import { approvalWrite } from "./approval.repo";
import { CREATOR_DEPARTMENTS_SQL } from "./flow-facts.repo";
import { productLinksRepo } from "./product-links.repo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dữ kiện manifest dựng từ hàng HĐ `c` (bí danh cố định). Khoá không có dữ liệu ⇒ bị bỏ (≡ null). `depts` = JSON mảng mã Group. */
const FACTS = (depts: string | null) => sql`jsonb_strip_nulls(jsonb_build_object(
    'total_value', case when jsonb_typeof(c.fields -> 'total_value' -> 'value') = 'number'
      then c.fields -> 'total_value' -> 'value' end,
    'deal', c.deal,
    'creator_department', ${depts}::jsonb,
    'new_partner', case when c.partner_key is null then null else not exists (
      select 1 from contracts.contracts o where o.tenant_id = c.tenant_id and o.partner_key = c.partner_key
        and o.kind = 'contract' and o.id <> c.id and o.confirmed_at is not null) end))`;

const deptsJson = (d: readonly string[] | null) => (d && d.length > 0 ? JSON.stringify(d) : null);

export function contractFlowRepo(tx: Tx, tid: string): ContractFlowRepo {
  return {
    shadow: (event, fn) => shadowEmit(tx, event, (sp) => fn(contractFlowRepo(sp, tid))),
    async emitContract(event, cid, versionKey, o) {
      const id = contractEventId(event, cid, versionKey);
      const rows = await tx.execute<{ id: string | null }>(sql`
        select hub.emit_flow_event(c.tenant_id, ${id}, ${event}, c.id::text, ${FACTS(deptsJson(o.departments))},
          ${o.actor}::uuid) as id
        from contracts.contracts c where c.id = ${cid}::uuid and c.tenant_id = ${tid}::uuid`);
      return rows[0]?.id != null;
    },
    async emitUploaded(cid, o) {
      const id = contractEventId("contract.uploaded", cid);
      const facts = JSON.stringify({
        file_type: o.fileType,
        ...(o.departments && o.departments.length > 0
          ? { uploader_department: o.departments }
          : {}),
      });
      const rows = await tx.execute<{ id: string | null }>(sql`
        select hub.emit_flow_event(c.tenant_id, ${id}, 'contract.uploaded', c.id::text, ${facts}::jsonb, ${o.actor}::uuid) as id
        from contracts.contracts c where c.id = ${cid}::uuid and c.tenant_id = ${tid}::uuid`);
      return rows[0]?.id != null;
    },
    async holdForFlow(cid, aid, links) {
      const pl = links && links.length > 0 ? JSON.stringify(links) : null;
      const rows = await tx.execute<{
        id: string;
      }>(sql`update contracts.approvals x set mode = 'engine',
          engine_run_id = null, feedback = ${FLOW_STARTING}, updated_at = now(),
          pending_links = coalesce(${pl}::jsonb, x.pending_links)
        where x.id = ${aid}::uuid and x.tenant_id = ${tid}::uuid and x.contract_id = ${cid}::uuid
          and x.status = 'level1' and x.mode = 'machine' and x.engine_run_id is null returning x.id`);
      return rows.length > 0;
    },
    async rearmFlow(cid, aid) {
      // P11b · "Mở lại" lượt chờ flow chưa có run ⇒ về FLOW_STARTING (rồi phát lại sự kiện với event_id mới). CAS chưa run.
      const rows = await tx.execute<{
        id: string;
      }>(sql`update contracts.approvals x set feedback = ${FLOW_STARTING}, updated_at = now()
        where x.id = ${aid}::uuid and x.tenant_id = ${tid}::uuid and x.contract_id = ${cid}::uuid
          and x.status = 'level1' and x.mode = 'engine' and x.engine_run_id is null
          -- P11c · chỉ khi ĐÃ kẹt thật: lý do khác FLOW_STARTING, hoặc FLOW_STARTING quá 2 phút (bấm đúp / sự kiện đầu đang chạy ⇒ 0 hàng)
          and (x.feedback is distinct from ${FLOW_STARTING}
            or x.updated_at < now() - make_interval(secs => ${FLOW_START_STALE_MS / 1000}::int))
        returning x.id`);
      return rows.length > 0;
    },
    async readFacts(cid) {
      if (!UUID.test(cid)) return null;
      const [r] = await tx.execute<{ facts: unknown; started_by: string | null }>(sql`
        select ${FACTS(null)} as facts, a.started_by
        from contracts.contracts c
        left join contracts.approvals a on a.id = c.run_id and a.tenant_id = c.tenant_id
        where c.id = ${cid}::uuid and c.tenant_id = ${tid}::uuid`);
      if (!r) return null;
      const facts = typeof r.facts === "string" ? JSON.parse(r.facts) : r.facts;
      return { facts: (facts ?? {}) as Record<string, unknown>, startedBy: r.started_by };
    },
  };
}

type Applied = { n: number; links: unknown; startedBy: string | null; approvalId: string };
const CONTRACT_STATUS: Record<ContractOutcome, string> = {
  approved: "active",
  rejected: "rejected",
  returned: "needs_review", // Nháp: HĐ giữ needs_review nhưng bỏ `run_id` ⇒ không còn lượt duyệt, người gửi sửa rồi gửi lại
};

/** MỘT câu: khoá HĐ + lượt đang mở → HĐ + lượt + event; chạy lại ⇒ 0 hàng (lượt không còn mở). */
async function applyQ(tx: Tx, tid: string, i: OutcomeInput, o: ContractOutcome): Promise<Applied> {
  const approved = o === "approved";
  const returned = o === "returned";
  const [r] = await tx.execute<{
    n: number;
    links: unknown;
    started_by: string | null;
    approval_id: string | null;
  }>(sql`with
    a0 as (select a.id, a.contract_id, a.started_by from contracts.approvals a
      join contracts.contracts c on c.id = a.contract_id and c.tenant_id = a.tenant_id and c.run_id = a.id
      where a.tenant_id = ${tid}::uuid and a.contract_id = ${i.ref}::uuid and a.status in ('level1', 'level2')
        and c.status = 'needs_review' for update of c),
    u as (update contracts.contracts c set status = ${CONTRACT_STATUS[o]},
        confirmed_at = case when ${approved}::boolean then now() else c.confirmed_at end,
        confirmed_by = case when ${approved}::boolean then ${i.actorId}::uuid else c.confirmed_by end,
        -- CR-122 · bước Ký số đã khoá HĐ; Từ chối / Trả lại ⇒ mở khoá (HĐ chưa xác nhận không giữ khoá)
        locked_at = case when ${approved}::boolean then c.locked_at else null end,
        locked_by = case when ${approved}::boolean then c.locked_by else null end,
        run_id = case when ${returned}::boolean then null else c.run_id end,
        version = c.version + 1, updated_at = now()
      from a0 where c.id = a0.contract_id and c.tenant_id = ${tid}::uuid returning c.id),
    a as (update contracts.approvals x set status = ${APPROVAL_STATUS_OF[o]}, mode = 'engine',
        engine_run_id = ${i.runId}::uuid, decided_by = ${i.actorId}::uuid, decided_at = now(), updated_at = now()
      from u, a0 where x.id = a0.id and x.tenant_id = ${tid}::uuid returning x.pending_links),
    ev as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      select ${tid}::uuid, u.id, ${o}, ${i.actorId}::uuid,
        jsonb_build_object('run_id', a0.id::text, 'engine_run_id', ${i.runId}::text) from u, a0)
    select (select count(*) from u)::int as n, (select pending_links from a limit 1) as links,
      (select started_by from a0 limit 1) as started_by, (select id from a0 limit 1) as approval_id`);
  return {
    n: r?.n ?? 0,
    links: r?.links ?? null,
    startedBy: r?.started_by ?? null,
    approvalId: r?.approval_id ?? "",
  };
}

/** Đã áp trước đó? (lượt gắn đúng run này và đã đóng đúng trạng thái của kết cục). */
async function appliedQ(tx: Tx, tid: string, i: OutcomeInput, o: ContractOutcome) {
  const [r] = await tx.execute<{
    ok: boolean;
  }>(sql`select exists (select 1 from contracts.approvals a
    where a.tenant_id = ${tid}::uuid and a.contract_id = ${i.ref}::uuid and a.engine_run_id = ${i.runId}::uuid
      and a.status = ${APPROVAL_STATUS_OF[o]}) as ok`);
  return r?.ok === true;
}

/** Gắn SP chờ của lượt (Đã duyệt khoá + gắn SP cùng tx; lỗi ⇒ ném ⇒ engine rollback, HĐ không khoá). */
async function linkPending(tx: Tx, tid: string, i: OutcomeInput, a: Applied): Promise<void> {
  const links = typeof a.links === "string" ? JSON.parse(a.links) : a.links;
  if (!Array.isArray(links) || links.length === 0) return;
  const by = i.actorId ?? a.startedBy;
  if (!by) return;
  const out = await productLinksRepo(tx, tid).link(i.ref, links, by);
  if (out.kind !== "ok") throw new Error(`contracts outcome: product-links ${out.kind}`);
}

/**
 * CR-122 · P11 · `OutcomeHandler.launched` cho `contract.submitted` (TRONG tx tạo run, role hub ⇒ đổi sang role gói): lượt đang chờ
 * flow (`mode engine`, CHƯA có run, khoá HĐ trước như `attach`) ⇒ `engine_run_id = run`, `flow_steps = []` (thẻ dựng bước từ run),
 * bỏ lý do. CAS `engine_run_id is null` ⇒ mở lại / hai Hub không gắn đè. MỘT câu.
 */
export async function attachFlowRun(
  tx: Tx,
  i: { tenantId: string; runId: string; ref: string },
): Promise<boolean> {
  const tid = i.tenantId;
  if (!UUID.test(i.ref) || !UUID.test(i.runId)) return false;
  return withPackRoleInTx(tx, CONTRACTS_PACK, tid, async () => {
    await approvalWrite(tx); // CR-109: cờ tx-local cho policy ghi HĐ (khoá FOR UPDATE)
    const rows = await tx.execute<{ id: string }>(sql`with c as (
        select id, run_id from contracts.contracts
        where id = ${i.ref}::uuid and tenant_id = ${tid}::uuid and status = 'needs_review' for update)
      update contracts.approvals x set engine_run_id = ${i.runId}::uuid, flow_steps = null, feedback = null,
        updated_at = now()
      from c where x.id = c.run_id and x.tenant_id = ${tid}::uuid and x.contract_id = c.id
        and x.status = 'level1' and x.mode = 'engine' and x.engine_run_id is null
      returning x.id`);
    return rows.length > 0;
  });
}

/**
 * CR-122 · P11b · `OutcomeHandler.notLaunched` cho `contract.submitted`: lượt CÒN chờ flow (`FLOW_STARTING`, chưa run) ⇒ ghi lý do (mã
 * máy, web dịch kèm cách sửa) ⇒ thẻ báo "kẹt" + Mở lại. CAS ⇒ lượt đã có run / đã đổi lý do không bị đè. MỘT câu.
 */
export async function markFlowNotLaunched(
  tx: Tx,
  i: { tenantId: string; ref: string; reason: string },
): Promise<boolean> {
  const tid = i.tenantId;
  if (!UUID.test(i.ref) || !UUID.test(tid)) return false;
  return withPackRoleInTx(tx, CONTRACTS_PACK, tid, async () => {
    const rows = await tx.execute<{ id: string }>(sql`update contracts.approvals x
        set feedback = ${i.reason.slice(0, 200)}, updated_at = now()
      from contracts.contracts c
      where c.id = ${i.ref}::uuid and c.tenant_id = ${tid}::uuid and x.id = c.run_id and x.tenant_id = ${tid}::uuid
        and x.status = 'level1' and x.mode = 'engine' and x.engine_run_id is null and x.feedback = ${FLOW_STARTING}
      returning x.id`);
    return rows.length > 0;
  });
}

/**
 * `OutcomeHandler.apply` cho `contract.submitted`: Đã duyệt (khoá + gắn SP + event `contract.approved`) / Từ chối / Trả lại về Nháp.
 * Idempotent theo `(runId, outcome)`: gọi lại ⇒ `already_applied`. HĐ/lượt không còn mở và chưa từng áp bởi run này ⇒ `not_found`.
 */
export async function applyContractOutcome(
  tx: Tx,
  i: OutcomeInput,
  o: ContractOutcome,
): Promise<OutcomeResult> {
  const tid = i.tenantId;
  if (!UUID.test(i.ref) || !UUID.test(i.runId)) return "not_found";
  const got = await withPackRoleInTx(tx, CONTRACTS_PACK, tid, async () => {
    await approvalWrite(tx); // CR-109: cờ tx-local cho policy ghi HĐ
    const a = await applyQ(tx, tid, i, o);
    if (a.n === 0) return { a, already: await appliedQ(tx, tid, i, o) };
    if (o === "approved") await linkPending(tx, tid, i, a);
    return { a, already: false };
  });
  if (got.a.n === 0) return got.already ? "already_applied" : "not_found";
  if (o === "approved") {
    // Người tạo → phòng ban (schema admin, đọc dưới role hub của engine), rồi ghi `contract.approved` dưới role gói cùng tx.
    const sb = got.a.startedBy;
    const dep =
      sb && UUID.test(sb)
        ? await tx.execute<{ keys: string[] | null }>(CREATOR_DEPARTMENTS_SQL(tid, sb))
        : [];
    const departments = dep[0]?.keys ?? [];
    await withPackRoleInTx(tx, CONTRACTS_PACK, tid, () =>
      contractFlowRepo(tx, tid).emitContract(EV_APPROVED, i.ref, got.a.approvalId, {
        actor: i.actorId,
        departments,
      }),
    );
  }
  return "applied";
}
