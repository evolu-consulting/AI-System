// my-activity-rag · nguồn hoạt động của gói contracts cho tool lõi `my-activity` (lớp 3). Chạy TRONG tx `PackUow` (role
// `contracts_rw`, RLS FORCE + luật thấy M1 theo `app.user_id` = người gọi). `mine`: chỉ hàng do CHÍNH người gọi làm
// (`actor_user_id` / `by_user` / `deleted_by` = người gọi) — `contract_delete_log`, `partner_event_voids` chỉ có RLS tenant nên lọc
// người tường minh. `record`: lịch sử một HĐ người gọi mở được (policy `contract_events_visible`) — như trang chi tiết.
// Mỗi lời gọi MỘT câu SQL; mỗi nhánh dùng index `(tenant_id, <người>, <giờ> DESC)` (0038) + LIMIT.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type {
  ActivityRow,
  ActivityWindow,
  RecordHistory,
} from "../../kit/application/activity.ports";

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;
const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', ${sql.raw(ISO)})`;

type Raw = Omit<ActivityRow, "detail"> & { detail: string | null };

function bounds(w: ActivityWindow) {
  return {
    lo: sql`coalesce((${w.from}::date)::timestamp at time zone ${w.tz}, '-infinity'::timestamptz)`,
    hi: sql`coalesce(((${w.to}::date) + 1)::timestamp at time zone ${w.tz}, 'infinity'::timestamptz)`,
  };
}

function contractParts(tid: string, uid: string, w: ActivityWindow): SQL[] {
  const { lo, hi } = bounds(w);
  const act = w.action ?? "%";
  return [
    sql`(select 'contract'::text as object, e.type as action, e.at, e.actor_user_id as actor_id, c.id as ref_id,
        c.title as name, c.number, null::text as party, e.data::text as detail
      from contracts.contract_events e join contracts.contracts c on c.id = e.contract_id and c.tenant_id = e.tenant_id
      where e.tenant_id = ${tid}::uuid and e.actor_user_id = ${uid}::uuid and e.at >= ${lo} and e.at < ${hi}
        and e.type like ${act} order by e.at desc limit ${w.limit}::int)`,
    sql`(select 'contract'::text, 'deleted'::text, d.deleted_at, d.deleted_by, null::uuid, d.title, d.number, null::text,
        d.impact::text
      from contracts.contract_delete_log d
      where d.tenant_id = ${tid}::uuid and d.deleted_by = ${uid}::uuid and d.deleted_at >= ${lo} and d.deleted_at < ${hi}
        and 'deleted' like ${act} order by d.deleted_at desc limit ${w.limit}::int)`,
  ];
}

function partnerParts(tid: string, uid: string, w: ActivityWindow): SQL[] {
  const { lo, hi } = bounds(w);
  const act = w.action ?? "%";
  return [
    sql`(select 'partner'::text, p.type, p.created_at, p.by_user, p.contract_id, c.title, c.number, p.party_key,
        jsonb_strip_nulls(jsonb_build_object('amount', p.amount, 'days_late', p.days_late, 'note', p.note))::text
      from contracts.partner_events p
      left join contracts.contracts c on c.id = p.contract_id and c.tenant_id = p.tenant_id
      where p.tenant_id = ${tid}::uuid and p.by_user = ${uid}::uuid and p.created_at >= ${lo} and p.created_at < ${hi}
        and p.type like ${act} order by p.created_at desc limit ${w.limit}::int)`,
    sql`(select 'partner'::text, 'voided_' || p.type, v.at, v.by_user, p.contract_id, null::text, null::text, p.party_key,
        null::text
      from contracts.partner_event_voids v
      join contracts.partner_events p on p.id = v.event_id and p.tenant_id = v.tenant_id
      where v.tenant_id = ${tid}::uuid and v.by_user = ${uid}::uuid and v.at >= ${lo} and v.at < ${hi}
        and ('voided_' || p.type) like ${act} order by v.at desc limit ${w.limit}::int)`,
  ];
}

async function mine(tx: Tx, tid: string, uid: string, w: ActivityWindow): Promise<ActivityRow[]> {
  const parts = [
    ...(w.objects.includes("contract") ? contractParts(tid, uid, w) : []),
    ...(w.objects.includes("partner") ? partnerParts(tid, uid, w) : []),
  ];
  if (parts.length === 0) return [];
  const rows =
    await tx.execute<Raw>(sql`select x.object, x.action, ${iso(sql`x.at`)} as at, x.actor_id,
      x.ref_id, x.name, x.number, x.party, x.detail
    from (${sql.join(parts, sql` union all `)}) as x(object, action, at, actor_id, ref_id, name, number, party, detail)
    order by x.at desc limit ${w.limit}::int`);
  return [...rows].map((r) => ({ ...r, detail: r.detail ?? undefined }));
}

type RecRaw = { id: string; title: string; number: string | null; events: string | null };

async function record(
  tx: Tx,
  tid: string,
  ref: { id: string | null; number: string | null },
  limit: number,
): Promise<RecordHistory[]> {
  const rows = await tx.execute<RecRaw>(sql`with k as (
      select c.id, c.title, c.number, c.created_at from contracts.contracts c
      where c.tenant_id = ${tid}::uuid
        and (c.id = ${ref.id}::uuid or (c.number is not null and lower(btrim(c.number)) = lower(${ref.number}::text)))
      order by c.created_at desc limit 5)
    select k.id, k.title, k.number,
      (select json_agg(json_build_object('at', ${iso(sql`e.at`)}, 'action', e.type, 'actor_id', e.actor_user_id,
          'detail', e.data) order by e.id desc)::text
        from (select e.id, e.type, e.at, e.actor_user_id, e.data from contracts.contract_events e
          where e.contract_id = k.id and e.tenant_id = ${tid}::uuid order by e.id desc limit ${limit}::int) e) as events
    from k order by k.created_at desc`);
  return [...rows].map((r) => ({
    id: r.id,
    title: r.title,
    number: r.number,
    events: (
      JSON.parse(r.events ?? "[]") as {
        at: string;
        action: string;
        actor_id: string | null;
        detail: unknown;
      }[]
    ).map((e) => ({
      ...e,
      object: "contract" as const,
      ref_id: r.id,
      name: r.title,
      number: r.number,
      party: null,
    })),
  }));
}

export const activityRepo = (tx: Tx, tenantId: string) => ({
  activity: {
    mine: (uid: string, w: ActivityWindow) => mine(tx, tenantId, uid, w),
    record: (ref: { id: string | null; number: string | null }, limit: number) =>
      record(tx, tenantId, ref, limit),
  },
});
