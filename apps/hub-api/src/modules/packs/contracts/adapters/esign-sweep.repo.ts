// esign-sweep · MỘT câu CTE của vòng nền bước Ký số (tx `PackSystemUow`, role gói + RLS tenant, lọc `tenant_id` tường minh): chọn bước
// mở của LƯỢT hiện tại (`contracts.run_id`) theo index một phần `approvals_esign_open_idx`, khoá `FOR UPDATE SKIP LOCKED` ≤ `limit`;
// `sending` quá hạn ⇒ `needs_decision` SEND_FAILED; `sent` ⇒ đặt mốc nhắc / chuyển cấp — vị từ ≡ `domain/esign-sweep.rules.ts`
// (`esignDueOf`). esign-remind-fix · nhánh nhắc join phong bì mở của HĐ (index một phần `esign_envelopes_open_uq`) ⇒ `wait` ≡
// `remindTargetOf` = "owner" (không tới lượt người ký công ty); không có phong bì mở ⇒ nhắc người ký như cũ. Một hàng chỉ bị MỘT nhánh UPDATE chạm (trạng thái loại trừ nhau). Văn bản cố định; mốc giờ là tham số `now`.
// Danh bạ chuyển cấp đọc `admin.*` qua hub scope (như `deptHeadOf`).
// CR-122 · E5b · hạn/nhắc: cột `esign_envelopes.due_h|remind_every_h` của phong bì MỞ đọc TRƯỚC (node Ký số đặt); trống ⇒ bước Ký số cũ.
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { ESIGN_EXPIRE_LEASE_MIN } from "../application/esign-expire";
import type { EsignSweepRepo, EsignSweptRow } from "../application/esign-sweep";
import type { EsignTurnSigner } from "../domain/esign-sweep.rules";
import { contractCodeSql } from "./contract-name.sql";

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
  wait: boolean;
};
const MEMBERS_MAX = 50;
/** Người ký `x` (phần tử `signers` jsonb) đã ký ≡ `signerDone` trong `domain/esign-sweep.rules.ts`. */
const done = (x: "m" | "p") =>
  sql.raw(
    `((${x}->>'signed_at') is not null or lower(coalesce(${x}->>'status', '')) in ('completed', 'signed'))`,
  );

export function esignSweepRepo(tx: Tx, t: string): EsignSweepRepo {
  return {
    sweepEnvelopes: esignEnvelopeSweep(tx, t),
    async sweep({ now, staleMin, limit }) {
      const at = now.toISOString();
      const rows = await tx.execute<Row>(sql`with
        o as (select a.id, a.esign_at, a.esign_signer, c.id as cid, c.owner_user_id as owner,
            ${contractCodeSql("c")} as label, f.grp, z.stale, z.remind, z.overdue, w.wait
          from contracts.approvals a
          join contracts.contracts c on c.id = a.contract_id and c.tenant_id = a.tenant_id and c.run_id = a.id
          left join lateral (select e.due_h, e.remind_every_h from contracts.esign_envelopes e
            where e.tenant_id = ${t}::uuid and e.contract_id = c.id and e.status in ('sent', 'delivered')
            order by e.created_at desc limit 1) en on true
          cross join lateral (select coalesce(en.due_h, (a.flow_steps->-1->>'due_h')::int) as due_h,
              coalesce(en.remind_every_h, (a.flow_steps->-1->>'remind_every_h')::int) as rem_h,
              a.flow_steps->-1->>'escalate_group_id' as grp) f
          cross join lateral (select
              (a.esign_status = 'sending'
                and a.esign_at < ${at}::timestamptz - make_interval(mins => ${staleMin}::int)) as stale,
              (a.esign_status = 'sent' and coalesce(f.rem_h, 0) > 0
                and greatest(a.esign_at, coalesce(a.esign_reminded_at, a.esign_at)) + make_interval(hours => f.rem_h)
                  <= ${at}::timestamptz) as remind,
              (a.esign_status = 'sent' and (a.esign_escalated_at is null or a.esign_escalated_at < a.esign_at)
                and a.esign_at + make_interval(hours => coalesce(f.due_h, 0)) <= ${at}::timestamptz) as overdue) z
          cross join lateral (select coalesce((select not exists (select 1 from jsonb_array_elements(e.signers) m
                where m->>'role' = 'company' and not ${done("m")}
                  and not exists (select 1 from jsonb_array_elements(e.signers) p
                    where (p->>'order')::int < (m->>'order')::int and not ${done("p")}))
              from contracts.esign_envelopes e
              where z.remind and e.tenant_id = ${t}::uuid and e.contract_id = c.id
                and e.status in ('sent', 'delivered')), false) as wait) w
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
        select o.id, o.cid, o.owner, o.esign_signer as signer, o.label, o.grp, o.stale, o.remind, o.overdue, o.wait
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
          waitPartner: r.wait === true,
        }),
      );
    },
  };
}

type EnvRow = {
  id: string;
  cid: string;
  owner: string | null;
  label: string | null;
  signers: EsignTurnSigner[] | string | null;
  remind: boolean;
  overdue: boolean;
  first: boolean;
};

/**
 * CR-122 · E5c · MỘT câu quét PHONG BÌ mở của node Ký số (không có bước Ký số kiểu cũ của lượt hiện tại — nhánh `approvals` ở trên giữ
 * nguyên): đọc `due_h`/`remind_every_h` của phong bì, mốc gửi = `created_at`. Nhắc khi `max(gửi, nhắc cuối) + chu kỳ ≤ now` ⇒ ghi `reminded_at`
 * (quét lại / instance khác không nhắc trùng); quá hạn ⇒ ghi `expired_at` lần đầu (`first` ⇒ chuông một lần) — hàng quá hạn trả mỗi lượt
 * tới khi phong bì thôi mở (huỷ ở nhà cung cấp hụt ⇒ thử lại). Quá hạn thì không nhắc nữa. `FOR UPDATE SKIP LOCKED`, lô ≤ `limit`.
 */
export function esignEnvelopeSweep(
  tx: Tx,
  t: string,
): NonNullable<EsignSweepRepo["sweepEnvelopes"]> {
  return async ({ now, limit }) => {
    const at = now.toISOString();
    const rows = await tx.execute<EnvRow>(sql`with
      o as (select e.id, e.contract_id as cid, c.owner_user_id as owner, ${contractCodeSql("c")} as label, e.signers,
          (z.remind and not z.overdue) as remind, z.overdue, (e.expired_at is null) as first, e.created_at
        from contracts.esign_envelopes e
        join contracts.contracts c on c.id = e.contract_id and c.tenant_id = e.tenant_id
        cross join lateral (select
            (coalesce(e.remind_every_h, 0) > 0
              and greatest(e.created_at, coalesce(e.reminded_at, e.created_at)) + make_interval(hours => e.remind_every_h)
                <= ${at}::timestamptz) as remind,
            (e.due_h is not null and e.created_at + make_interval(hours => e.due_h) <= ${at}::timestamptz) as overdue) z
        where e.tenant_id = ${t}::uuid and e.status in ('sent', 'delivered')
          and (e.due_h is not null or e.remind_every_h is not null) and (z.remind or z.overdue)
          -- E5d · phong bì đang được một tiến trình khác giữ quyền huỷ (lease chưa hết) ⇒ không trả về
          and (e.expire_claimed_at is null
            or e.expire_claimed_at <= ${at}::timestamptz - make_interval(mins => ${ESIGN_EXPIRE_LEASE_MIN}::int))
          and not exists (select 1 from contracts.approvals a
            where a.tenant_id = e.tenant_id and a.id = c.run_id and a.esign_status in ('sending', 'sent')
              and a.flow_steps->-1->>'kind' = 'esign')
        order by e.created_at, e.id limit ${limit}::int
        for update of e skip locked),
      u as (update contracts.esign_envelopes x set
          reminded_at = case when o.remind then ${at}::timestamptz else x.reminded_at end,
          expired_at = case when o.overdue and x.expired_at is null then ${at}::timestamptz else x.expired_at end
        from o where x.id = o.id and x.tenant_id = ${t}::uuid returning x.id)
      select o.id, o.cid, o.owner, o.label, o.signers, o.remind, o.overdue, o.first
      from o where o.id in (select id from u) order by o.created_at, o.id`);
    return rows.map((r) => ({
      envelopeId: r.id,
      contractId: r.cid,
      owner: r.owner,
      label: (r.label ?? "").slice(0, 120),
      signers: (typeof r.signers === "string"
        ? JSON.parse(r.signers)
        : (r.signers ?? [])) as EsignTurnSigner[],
      remind: r.remind === true,
      overdue: r.overdue === true,
      first: r.first === true,
    }));
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
