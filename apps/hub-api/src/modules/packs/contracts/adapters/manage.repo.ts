// gap-a1 · SQL trang chi tiết HĐ trong tx `PackUow` (role `contracts_rw`, RLS FORCE + luật thấy M1 theo `app.user_id`): lịch sử (dùng lại
// `activityRepo.record`), giao người phụ trách, sửa hoa hồng %, lưu tóm tắt AI. Mỗi thao tác ≤ 3 câu SQL cố định; HĐ không thấy / tenant
// khác ⇒ như không có.
import type { HistoryItem } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ManageRepo, SummarySource } from "../application/manage.usecase";
import { activityRepo } from "./activity.repo";

type Raw = { version: number; updated_at: string | Date };
const iso = (v: string | Date): string => new Date(v).toISOString();
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

export function manageRepo(tx: Tx, tenantId: string): { manage: ManageRepo } {
  const act = activityRepo(tx, tenantId).activity;
  return {
    manage: {
      history: async (id, limit): Promise<HistoryItem[] | null> => {
        const [h] = await act.record({ id, number: null }, limit);
        if (!h) return null;
        return h.events.map((e) => ({
          type: e.action,
          actor_user_id: e.actor_id,
          at: e.at,
          data: e.detail ?? {},
        }));
      },

      setOwner: async (id, owner, actor) => {
        const rows = await tx.execute<{ prev: string | null }>(sql`with old as (
            select c.owner_user_id from contracts.contracts c
            where c.id = ${id}::uuid and c.tenant_id = ${tenantId}::uuid for update),
          u as (
            update contracts.contracts set owner_user_id = ${owner}::uuid, updated_at = now()
            where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and exists (select 1 from old) returning id),
          e as (
            insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
            select ${tenantId}::uuid, u.id, 'owner_assigned', ${actor}::uuid,
              jsonb_build_object('from', (select owner_user_id from old), 'to', ${owner}::uuid) from u)
          select old.owner_user_id as prev from old, u`);
        return rows[0] ? { kind: "ok" as const } : { kind: "not_found" as const };
      },

      lockCommission: async (id) => {
        const rows = await tx.execute<
          Raw & { deal: string | null; status: string; commission_pct: string | number | null }
        >(sql`select c.version, c.updated_at, c.deal, c.status, c.commission_pct from contracts.contracts c
          where c.id = ${id}::uuid and c.tenant_id = ${tenantId}::uuid for update`);
        const r = rows[0];
        return r
          ? {
              version: r.version,
              updated_at: iso(r.updated_at),
              deal: r.deal,
              status: r.status,
              commission_pct: num(r.commission_pct),
            }
          : null;
      },
      saveCommission: async (id, expected, from, to, actor) => {
        const rows = await tx.execute<Raw>(sql`with u as (
            update contracts.contracts set commission_pct = ${to}::numeric, commission_fixed = null,
              version = version + 1, updated_at = now()
            where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and version = ${expected}::int
            returning id, version, updated_at),
          e as (
            insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
            select ${tenantId}::uuid, u.id, 'commission_edited', ${actor}::uuid,
              jsonb_build_object('from', ${from}::numeric, 'to', ${to}::numeric) from u)
          select u.version, u.updated_at from u`);
        const r = rows[0];
        if (!r) throw new Error("commission: row vanished under lock");
        return { version: r.version, updated_at: iso(r.updated_at) };
      },

      summarySource: async (id): Promise<SummarySource | null> => {
        const rows = await tx.execute<{
          status: string;
          title: string;
          source_text: string | null;
          has_summary: boolean;
        }>(sql`select c.status, c.title, c.source_text,
            coalesce(jsonb_typeof(c.ai_read -> 'summary') = 'object', false) as has_summary
          from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${tenantId}::uuid`);
        const r = rows[0];
        return r
          ? {
              status: r.status,
              title: r.title,
              text: r.source_text,
              hasSummary: r.has_summary,
            }
          : null;
      },
      saveSummary: async (id, summary, actor) => {
        const rows = await tx.execute<{ id: string }>(sql`with u as (
            update contracts.contracts set updated_at = now(),
              ai_read = coalesce(ai_read, '{"deal":null,"unsure":[],"milestones":[]}'::jsonb)
                || jsonb_build_object('summary', ${JSON.stringify(summary)}::jsonb)
            where id = ${id}::uuid and tenant_id = ${tenantId}::uuid
              and coalesce(jsonb_typeof(ai_read -> 'summary') = 'object', false) = false
            returning id),
          e as (
            insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
            select ${tenantId}::uuid, u.id, 'summary_generated', ${actor}::uuid, '{}'::jsonb from u)
          select u.id from u`);
        return rows[0] !== undefined;
      },
    },
  };
}
