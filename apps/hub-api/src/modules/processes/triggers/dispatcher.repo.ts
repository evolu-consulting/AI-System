// CR-122 · E1 · FLOW2-FR-19/20 · SQL của bộ điều phối — mỗi lô số câu CỐ ĐỊNH (Luật 4c): nhận lô (1), flow ứng viên (1), cờ (1),
// chốt lô (1). Câu văn bản hằng; dữ liệu lô qua mảng `= any` / một tham số JSON. Gọi trong tx scope system.
import type { FactWhen } from "@ai/contracts/hub-admin";
import { START_FORM_NODE_KEY } from "@ai/contracts/modules";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { FlowEventInput } from "../../packs/kit/public";
import { FLOW_EVENT_ATTEMPTS_MAX, type FlowCandidate } from "./match.rules";
import { scheduleDaysOf } from "./schedule.rules";

export type ClaimedEvent = {
  id: string;
  tenant_id: string;
  event: string;
  ref: string;
  facts: Record<string, unknown>;
  actor_id: string | null;
  attempts: number;
};
/** `defTenantId` null ⇒ flow Thư viện được gán (chạy bản xuất bản mới nhất). */
export type CandidateRow = FlowCandidate & {
  tenantId: string;
  event: string;
  defTenantId: string | null;
  /** N1 · khoá node bảng (`stage.node`) của def — kiểm tính năng còn bật lúc mở lượt. */
  nodes: string[];
};
export type EventFinish = {
  id: string;
  /** null ⇒ xong (processed_at = now). */
  retryAt: Date | null;
  error: string | null;
  outcome: Record<string, unknown>;
};

const arr = (xs: readonly string[]) => `{${[...new Set(xs)].join(",")}}`;

/**
 * App ghi sự kiện CÙNG tx bản ghi qua `hub.emit_flow_event` (SECURITY DEFINER, hub 0109): gọi được từ tx gói (role `<k>_rw`) lẫn tx
 * hub scope user; CHỈ cho tenant hiện tại của tx (`app.tenant_id`) — khác ⇒ 42501. Trùng `(tenant_id, event_id)` ⇒ bỏ qua. MỘT câu.
 */
export async function insertFlowEvents(tx: Tx, evs: readonly FlowEventInput[]): Promise<number> {
  if (evs.length === 0) return 0;
  const rows = evs.map((e) => ({
    tenant_id: e.tenantId,
    event_id: e.eventId,
    event: e.event,
    ref: e.ref,
    facts: e.facts,
    actor_id: e.actorId,
  }));
  const [r] = await tx.execute<{ n: number }>(sql`select count(id)::int as n from (
      select hub.emit_flow_event(x.tenant_id, x.event_id, x.event, x.ref, x.facts, x.actor_id) as id
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        as x(tenant_id uuid, event_id text, event text, ref text, facts jsonb, actor_id uuid)) s`);
  return r?.n ?? 0;
}

/** Sự kiện hết lượt thử mà Hub chết giữa chừng (attempts = 5, lease đã qua, chưa xong) ⇒ chốt lỗi `lease_exhausted`. MỘT câu.
 *  P11b · trả sự kiện đã chốt (bộ điều phối báo app "không mở được lượt"). */
export async function closeExhausted(
  tx: Tx,
  now: Date,
): Promise<{ id: string; tenant_id: string; event: string; ref: string }[]> {
  return tx.execute<{
    id: string;
    tenant_id: string;
    event: string;
    ref: string;
  }>(sql`update hub.flow_events set processed_at = ${now.toISOString()}::timestamptz,
      error = 'lease_exhausted'
    where processed_at is null and attempts >= ${FLOW_EVENT_ATTEMPTS_MAX}
      and next_at <= ${now.toISOString()}::timestamptz returning id, tenant_id, event, ref`);
}

/**
 * Nhận lô (`FOR UPDATE SKIP LOCKED` ⇒ hai Hub không lấy trùng) và GIỮ CHỖ: `attempts + 1`, `next_at = now + lease` ⇒ Hub chết giữa
 * chừng thì sự kiện tự quay lại sau `lease`. Chỉ sự kiện còn lượt thử (`attempts < 5`).
 */
export async function claimEvents(
  tx: Tx,
  now: Date,
  limit: number,
  leaseMs: number,
): Promise<ClaimedEvent[]> {
  const lease = new Date(now.getTime() + leaseMs).toISOString();
  return tx.execute<ClaimedEvent>(sql`update hub.flow_events e set attempts = e.attempts + 1,
      next_at = ${lease}::timestamptz
    where e.id in (select id from hub.flow_events
      where processed_at is null and next_at <= ${now.toISOString()}::timestamptz
        and attempts < ${FLOW_EVENT_ATTEMPTS_MAX}
      order by next_at limit ${limit} for update skip locked)
    returning e.id, e.tenant_id, e.event, e.ref, e.facts, e.actor_id, e.attempts`);
}

/** Flow đang bật của các công ty × sự kiện trong lô (lọc cặp trong bộ nhớ), sắp `position, id`. */
export async function candidatesOf(tx: Tx, evs: readonly ClaimedEvent[]): Promise<CandidateRow[]> {
  if (evs.length === 0) return [];
  const rows = await tx.execute<{
    id: string;
    tenant_id: string;
    flow_id: string;
    position: number;
    key: string;
    def_tenant_id: string | null;
    nodes: string[] | null;
    trigger_event: string;
    trigger: { when?: FactWhen; params?: unknown } | null;
  }>(sql`select cf.id, cf.tenant_id, cf.flow_id, cf.position, d.key, d.tenant_id as def_tenant_id,
      d.trigger_event, d.trigger,
      (select jsonb_agg(distinct s ->> 'node') from jsonb_array_elements(d.stages) s where s ? 'node') as nodes
    from hub.company_flows cf
    join hub.process_defs d on d.id = cf.flow_id and d.deleted_at is null
      and (d.tenant_id = cf.tenant_id or d.tenant_id is null)
    left join hub.process_def_releases rl on d.tenant_id is null and rl.def_id = d.id
      and rl.rel_version = d.published_version
    where cf.enabled and cf.tenant_id = any(${arr(evs.map((e) => e.tenant_id))}::uuid[])
      and d.trigger_event = any(${arr(evs.map((e) => e.event))}::text[])
      -- flow bắt đầu bằng phiếu KHÔNG BAO GIỜ là ứng viên của sự kiện (cùng định nghĩa "stage đầu" với manual-start.repo.startFlows)
      and coalesce((case when d.tenant_id is null then rl.stages else d.stages end) -> 0 ->> 'node', '') <> ${START_FORM_NODE_KEY}::text
    order by cf.tenant_id, d.trigger_event, cf.position, cf.id`);
  return rows.map((r) => ({
    companyFlowId: r.id,
    flowId: r.flow_id,
    defKey: r.key,
    position: r.position,
    when: r.trigger?.when ?? null,
    days: scheduleDaysOf(r.trigger_event, r.trigger?.params), // CR-127 E6 · R#12
    tenantId: r.tenant_id,
    event: r.trigger_event,
    defTenantId: r.def_tenant_id,
    nodes: r.nodes ?? [],
  }));
}

/** Chốt cả lô MỘT câu: xong ⇒ `processed_at`; thử lại ⇒ `next_at`; luôn ghi `outcome` + `error`. */
export async function finishEvents(tx: Tx, now: Date, rows: readonly EventFinish[]): Promise<void> {
  if (rows.length === 0) return;
  const data = rows.map((r) => ({
    id: r.id,
    retry_at: r.retryAt?.toISOString() ?? null,
    error: r.error?.slice(0, 500) ?? null,
    outcome: r.outcome,
  }));
  await tx.execute(sql`update hub.flow_events e set
      processed_at = case when x.retry_at is null then ${now.toISOString()}::timestamptz end,
      next_at = coalesce(x.retry_at, e.next_at), error = x.error, outcome = x.outcome
    from jsonb_to_recordset(${JSON.stringify(data)}::jsonb)
      as x(id uuid, retry_at timestamptz, error text, outcome jsonb)
    where e.id = x.id`);
}
