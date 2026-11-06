// CR-122 · A2 · FLOW2-FR-12/15/19 · SQL của 3 sự kiện Community. Mỗi hàm MỘT câu, văn bản hằng, `tenant_id` tường minh ngoài RLS (Luật 4c).
//   emitFlowEvent  — ghi `hub.flow_events` CÙNG tx bản ghi qua hàm SECURITY DEFINER `hub.emit_flow_event` (migration 0109; role
//                    `community_rw` không có quyền bảng). Tenant phải trùng `app.tenant_id` của tx; trùng event_id ⇒ NULL (idempotent).
//   factsOf        — dữ kiện HIỆN TẠI của bản ghi (FactsReader), tx gói riêng.
//   apply*Outcome  — kết quả Kết thúc ⇒ trạng thái bản ghi: so-sánh-và-đặt theo trạng thái chờ ⇒ gọi lại cùng (runId, outcome) không đổi
//                    gì (`already_applied`), kết quả cũ không ghi đè quyết định khác.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import {
  type FlowEventInput,
  type OutcomeResult,
  type PackWho,
  shadowEmit,
} from "../../kit/public";
import {
  type CommunityEvent,
  EV_JOIN,
  EV_POST,
  EV_REPORT,
  eventIdOf,
  type Facts,
  joinFacts,
  postFacts,
  reportFacts,
} from "../domain/flow-events.rules";
import { uuids } from "./flows.repo";

export async function emitFlowEvent(tx: Tx, e: FlowEventInput): Promise<boolean> {
  const r = await tx.execute<{ id: string | null }>(sql`select hub.emit_flow_event(
      ${e.tenantId}::uuid, ${e.eventId}, ${e.event}, ${e.ref}, ${JSON.stringify(e.facts)}::jsonb, ${e.actorId}::uuid) as id`);
  return r[0]?.id != null;
}

/**
 * Ghi sự kiện CÙNG tx bản ghi; `event_id` ổn định theo bản ghi ⇒ ghi lại không mở lượt thứ hai. `on` = cờ `FLOW_TRIGGERS`: tắt ⇒ chỉ
 * để ghi bóng, chạy trong SAVEPOINT (lỗi ⇒ rollback về savepoint + log, tx bản ghi chạy tiếp); bật ⇒ lỗi làm hỏng tx.
 */
export async function emitEvent(
  tx: Tx,
  who: PackWho,
  event: CommunityEvent,
  ref: string,
  facts: Facts,
  on: boolean,
): Promise<void> {
  const emit = (t: Tx) =>
    emitFlowEvent(t, {
      tenantId: who.tenantId,
      event,
      ref,
      eventId: eventIdOf(event, ref),
      facts,
      actorId: who.userId,
    });
  if (on) await emit(tx);
  else await shadowEmit(tx, event, emit);
}

/** Dữ kiện hiện tại (một câu theo sự kiện); không thấy trong tenant ⇒ null (không lộ tồn tại). */
export async function factsOf(
  tx: Tx,
  tenantId: string,
  event: string,
  ref: string,
): Promise<Facts | null> {
  if (uuids([ref]).length === 0) return null;
  if (event === EV_POST) {
    const [p] = await tx.execute<{ type: string; author_org: string | null }>(
      sql`select p.type, p.author_org::text as author_org from community.posts p
        where p.id = ${ref}::uuid and p.tenant_id = ${tenantId}::uuid`,
    );
    return p ? postFacts(p) : null;
  }
  if (event === EV_JOIN) {
    const [j] = await tx.execute<{ company: string; email: string }>(
      sql`select j.company, j.email from community.join_requests j
        where j.id = ${ref}::uuid and j.tenant_id = ${tenantId}::uuid`,
    );
    return j ? joinFacts(j) : null;
  }
  if (event === EV_REPORT) {
    const [r] = await tx.execute<{ triage_kind: string | null; triage_level: string | null }>(
      sql`select r.triage_kind, r.triage_level from community.reports r
        where r.id = ${ref}::uuid and r.tenant_id = ${tenantId}::uuid`,
    );
    return r ? reportFacts(r) : null;
  }
  return null;
}

type Applied = { n: number; ex: boolean };
const result = ({ n, ex }: Applied): OutcomeResult =>
  Number(n) > 0 ? "applied" : ex ? "already_applied" : "not_found";

/** Hiện bài (pending ⇒ approved) / Ẩn bài (pending|none ⇒ rejected). Bài đã ở trạng thái khác ⇒ giữ nguyên. */
export async function applyPostOutcome(
  tx: Tx,
  tenantId: string,
  ref: string,
  target: "approved" | "rejected",
): Promise<OutcomeResult> {
  if (uuids([ref]).length === 0) return "not_found";
  const from = target === "approved" ? ["pending"] : ["pending", "none"];
  const [r] = await tx.execute<Applied>(sql`with u as (
      update community.posts set moderation = ${target}, mod_decided_name = 'Quy trình', mod_decided_at = now()
      where id = ${ref}::uuid and tenant_id = ${tenantId}::uuid
        and moderation = any(array(select jsonb_array_elements_text(${JSON.stringify(from)}::jsonb))) returning id
    ) select (select count(*) from u)::int as n,
      exists (select 1 from community.posts where id = ${ref}::uuid and tenant_id = ${tenantId}::uuid) as ex`);
  return result(r as Applied);
}

/** Nhận ⇒ approved + liên kết công ty đối tác (nhãn xin) CÙNG câu; Từ chối ⇒ rejected. Chỉ khi đang chờ. */
export async function applyJoinOutcome(
  tx: Tx,
  tenantId: string,
  ref: string,
  target: "approved" | "rejected",
): Promise<OutcomeResult> {
  if (uuids([ref]).length === 0) return "not_found";
  const [r] = await tx.execute<Applied>(sql`with j as (
      update community.join_requests set status = ${target}, decided_name = 'Quy trình', decided_at = now()
      where id = ${ref}::uuid and tenant_id = ${tenantId}::uuid and status = 'pending'
      returning tenant_id, requester_org, labels
    ), p as (
      insert into community.partner_companies (tenant_id, ext_org_id, labels, cats, area, party_key, updated_by)
      select tenant_id, requester_org, labels, '{}'::text[], '', null, null from j where ${target} = 'approved'
      on conflict (tenant_id, ext_org_id) do update set labels = excluded.labels, updated_at = now() returning 1
    ) select (select count(*) from j)::int as n,
      exists (select 1 from community.join_requests where id = ${ref}::uuid and tenant_id = ${tenantId}::uuid) as ex`);
  return result(r as Applied);
}

/** Ẩn ⇒ hide (+ ẩn bài), Giữ ⇒ dismiss, Cảnh báo ⇒ warn. Chỉ khi báo cáo đang chờ. */
export async function applyReportOutcome(
  tx: Tx,
  tenantId: string,
  ref: string,
  action: "hide" | "dismiss" | "warn",
): Promise<OutcomeResult> {
  if (uuids([ref]).length === 0) return "not_found";
  const [r] = await tx.execute<Applied>(sql`with r as (
      update community.reports set status = 'resolved', action = ${action}, decided_name = 'Quy trình', decided_at = now()
      where id = ${ref}::uuid and tenant_id = ${tenantId}::uuid and status = 'pending' returning post_id, tenant_id
    ), h as (
      update community.posts p set hidden = true from r
      where ${action} = 'hide' and p.id = r.post_id and p.tenant_id = r.tenant_id returning p.id
    ) select (select count(*) from r)::int as n,
      exists (select 1 from community.reports where id = ${ref}::uuid and tenant_id = ${tenantId}::uuid) as ex`);
  return result(r as Applied);
}
