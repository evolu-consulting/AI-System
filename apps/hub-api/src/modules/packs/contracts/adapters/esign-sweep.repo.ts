// esign-sweep · MỘT câu CTE của vòng nền bước Ký số (tx `PackSystemUow`, role gói + RLS tenant, lọc `tenant_id` tường minh): chọn bước
// mở của LƯỢT hiện tại (`contracts.run_id`) theo index một phần `approvals_esign_open_idx`, khoá `FOR UPDATE SKIP LOCKED` ≤ `limit`;
// `sending` quá hạn ⇒ `needs_decision` SEND_FAILED; `sent` ⇒ đặt mốc nhắc / chuyển cấp — vị từ ≡ `domain/esign-sweep.rules.ts`
// (`esignDueOf`). Một hàng chỉ bị MỘT nhánh UPDATE chạm (trạng thái loại trừ nhau). Văn bản cố định; mốc giờ là tham số `now`.
// Danh bạ chuyển cấp đọc `admin.*` qua hub scope (như `deptHeadOf`).
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { EsignSweepRepo, EsignSweptRow } from "../application/esign-sweep";

type Row = {
  id: string;
  cid: string;
  owner: string | null;
  signer: string | null;
  label: string | null;
  grp: string | null;
  stale: boolean;
  remind: boolean;
  overdue: boolean;
};
const MEMBERS_MAX = 50;

export function esignSweepRepo(tx: Tx, t: string): EsignSweepRepo {
  return {
    async sweep({ now, staleMin, limit }) {
      const at = now.toISOString();
      const rows = await tx.execute<Row>(sql`with
        o as (select a.id, a.esign_at, a.esign_signer, c.id as cid, c.owner_user_id as owner,
            coalesce(c.number, c.title) as label, f.grp, z.stale, z.remind, z.overdue
          from contracts.approvals a
          join contracts.contracts c on c.id = a.contract_id and c.tenant_id = a.tenant_id and c.run_id = a.id
          cross join lateral (select (a.flow_steps->-1->>'due_h')::int as due_h,
              (a.flow_steps->-1->>'remind_every_h')::int as rem_h, a.flow_steps->-1->>'escalate_group_id' as grp) f
          cross join lateral (select
              (a.esign_status = 'sending'
                and a.esign_at < ${at}::timestamptz - make_interval(mins => ${staleMin}::int)) as stale,
              (a.esign_status = 'sent' and coalesce(f.rem_h, 0) > 0
                and greatest(a.esign_at, coalesce(a.esign_reminded_at, a.esign_at)) + make_interval(hours => f.rem_h)
                  <= ${at}::timestamptz) as remind,
              (a.esign_status = 'sent' and (a.esign_escalated_at is null or a.esign_escalated_at < a.esign_at)
                and a.esign_at + make_interval(hours => coalesce(f.due_h, 0)) <= ${at}::timestamptz) as overdue) z
          where a.tenant_id = ${t}::uuid and a.esign_status in ('sending', 'sent') and a.esign_at is not null
            and a.flow_steps->-1->>'kind' = 'esign' and (z.stale or z.remind or z.overdue)
          order by a.esign_at, a.id limit ${limit}::int
          for update of a skip locked),
        s as (update contracts.approvals x set esign_status = 'needs_decision', esign_reason = 'SEND_FAILED',
            esign_at = ${at}::timestamptz, updated_at = now()
          from o where o.stale and x.id = o.id and x.tenant_id = ${t}::uuid and x.esign_status = 'sending'
          returning x.id),
        u as (update contracts.approvals x set
            esign_reminded_at = case when o.remind then ${at}::timestamptz else x.esign_reminded_at end,
            esign_escalated_at = case when o.overdue then ${at}::timestamptz else x.esign_escalated_at end
          from o where (o.remind or o.overdue) and x.id = o.id and x.tenant_id = ${t}::uuid and x.esign_status = 'sent'
          returning x.id)
        select o.id, o.cid, o.owner, o.esign_signer as signer, o.label, o.grp, o.stale, o.remind, o.overdue
        from o where o.id in (select id from s union all select id from u)
        order by o.esign_at, o.id`);
      return rows.map(
        (r): EsignSweptRow => ({
          approvalId: r.id,
          contractId: r.cid,
          owner: r.owner,
          signer: r.signer,
          label: (r.label ?? "").slice(0, 120),
          escalateGroupId: r.overdue ? r.grp : null,
          stale: r.stale === true,
          remind: r.remind === true,
          overdue: r.overdue === true,
        }),
      );
    },
  };
}

/** Người nhận chuyển cấp theo Group (cùng tenant): trưởng phòng của Group còn dùng được; không có ⇒ thành viên còn dùng được (≤ 50).
 *  MỘT câu cho cả lô (danh sách Group qua một tham số JSON). */
export const escalateTargetsOf =
  (db: Db) =>
  async (tenantId: string, groupIds: readonly string[]): Promise<Map<string, string[]>> => {
    const out = new Map<string, string[]>();
    if (groupIds.length === 0) return out;
    const rows = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<{ g: string; users: string[] | null }>(sql`
        select g.id::text as g, coalesce(
          (select array[u.id::text] from admin.departments dp join admin.users u on u.id = dp.head_user_id
             and u.tenant_id = dp.tenant_id and u.active and not u.locked_by_tenant
           where dp.tenant_id = g.tenant_id and dp.group_id = g.id limit 1),
          array(select u.id::text from admin.group_members gm join admin.users u on u.id = gm.user_id
              and u.tenant_id = gm.tenant_id and u.active and not u.locked_by_tenant
            where gm.tenant_id = g.tenant_id and gm.group_id = g.id order by u.id limit ${MEMBERS_MAX}::int)) as users
        from admin.groups g
        where g.tenant_id = ${tenantId}::uuid
          and g.id = any(array(select jsonb_array_elements_text(${JSON.stringify(groupIds)}::jsonb))::uuid[])`),
    );
    for (const r of rows) out.set(r.g, r.users ?? []);
    return out;
  };
