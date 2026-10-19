// N3-FR-05 · N3-FR-06 · N3-NFR-01 · câu SQL của worker (scope `system`, role `hub_api`). Mỗi hàm = MỘT tx = MỘT câu CTE
// (+ `set_config` scope). Văn bản SQL cố định, dữ liệu lô qua MỘT tham số jsonb, không join `unnest` (kế hoạch không phụ thuộc
// thống kê bảng). `FOR UPDATE SKIP LOCKED` ⇒ nhiều instance không giẫm nhau; không gọi mạng trong tx.
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { DispatchStore, Settlement } from "../application/ports";
import type { Claimed } from "../domain/notify.rules";

type ClaimRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  channel: "email" | "push";
  attempts: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  email: string;
  display_name: string;
  locale: string;
  subs: { endpoint: string; p256dh: string; auth: string }[];
};

const toClaimed = (r: ClaimRow): Claimed => ({
  id: String(r.id),
  tenantId: r.tenant_id,
  userId: r.user_id,
  channel: r.channel,
  attempts: Number(r.attempts),
  kind: r.kind,
  title: r.title,
  body: r.body,
  link: r.link,
  email: r.email,
  displayName: r.display_name,
  locale: r.locale === "en" ? "en" : "vi",
  subs: r.subs,
});

const system = { kind: "system" } as const;

/** Chia kênh theo tùy chọn HIỆN TẠI: email cần địa chỉ + user còn dùng được; push cần ≥ 1 đăng ký. In-app luôn có. */
async function fanout(tx: Tx, nowIso: string, limit: number) {
  const rows = await tx.execute<{ picked: number; deliveries: number }>(sql`
    with picked as (
      select n.id, n.tenant_id, n.user_id from hub.notifications n
      where n.fanout_at is null order by n.seq limit ${limit} for update skip locked),
    want as (
      select p.id, p.tenant_id, p.user_id, c.channel
      from picked p
      join admin.users u on u.id = p.user_id and u.tenant_id = p.tenant_id and u.active and not u.locked_by_tenant
      left join hub.notify_prefs pr on pr.tenant_id = p.tenant_id and pr.user_id = p.user_id
      cross join (values ('email'), ('push')) c(channel)
      where (c.channel = 'email' and coalesce(pr.email, true) and coalesce(u.email, '') <> '')
         or (c.channel = 'push' and coalesce(pr.push, true) and exists (
              select 1 from hub.push_subscriptions s where s.tenant_id = p.tenant_id and s.user_id = p.user_id))),
    ins as (
      insert into hub.notification_deliveries (notification_id, tenant_id, user_id, channel, next_attempt_at)
      select id, tenant_id, user_id, channel, ${nowIso}::timestamptz from want
      on conflict (notification_id, channel) do nothing returning 1),
    upd as (
      update hub.notifications n set fanout_at = ${nowIso}::timestamptz from picked p where n.id = p.id returning 1)
    select (select count(*) from upd)::int as picked, (select count(*) from ins)::int as deliveries`);
  return { picked: Number(rows[0]?.picked ?? 0), deliveries: Number(rows[0]?.deliveries ?? 0) };
}

/** Nhận lô tới hạn (SKIP LOCKED) + đặt `sending` với hạn thuê; trả kèm nội dung/địa chỉ/đăng ký push để gửi ngoài tx. */
async function claim(tx: Tx, nowIso: string, limit: number, leaseSec: number) {
  const rows = await tx.execute<ClaimRow>(sql`
    with due as (
      select d.id from hub.notification_deliveries d
      where d.status in ('pending', 'sending') and d.next_attempt_at <= ${nowIso}::timestamptz
      order by d.next_attempt_at, d.id limit ${limit} for update skip locked),
    upd as (
      update hub.notification_deliveries d set status = 'sending', attempts = d.attempts + 1,
        next_attempt_at = ${nowIso}::timestamptz + make_interval(secs => ${leaseSec})
      from due where d.id = due.id
      returning d.id, d.notification_id, d.tenant_id, d.user_id, d.channel, d.attempts)
    select upd.id::text as id, upd.tenant_id, upd.user_id, upd.channel, upd.attempts, n.kind, n.title, n.body, n.link,
      coalesce(u.email, '') as email, coalesce(u.display_name, '') as display_name, coalesce(u.locale, 'vi') as locale,
      case when upd.channel = 'push' then (
        select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
        from hub.push_subscriptions s where s.tenant_id = upd.tenant_id and s.user_id = upd.user_id)
      else '[]'::jsonb end as subs
    from upd
    join hub.notifications n on n.id = upd.notification_id and n.tenant_id = upd.tenant_id
    left join admin.users u on u.id = upd.user_id and u.tenant_id = upd.tenant_id`);
  return rows.map(toClaimed);
}

/** Ghi kết cục cả lô (một tham số jsonb) + xóa đăng ký push hết hạn. Chỉ cập nhật bản gửi còn `sending`. */
async function settle(
  tx: Tx,
  nowIso: string,
  results: readonly Settlement[],
  gone: readonly string[],
) {
  if (results.length === 0 && gone.length === 0) return 0;
  const batch = JSON.stringify(
    results.map((r) => ({ id: r.id, outcome: r.outcome, error: r.error, next_at: r.nextAt })),
  );
  const rows = await tx.execute<{ updated: number }>(sql`
    with r as (
      select * from jsonb_to_recordset(${batch}::jsonb) as x(id bigint, outcome text, error text, next_at timestamptz)),
    upd as (
      update hub.notification_deliveries d set
        status = case r.outcome when 'sent' then 'sent' when 'retry' then 'pending' else 'dead' end,
        next_attempt_at = coalesce(r.next_at, d.next_attempt_at), last_error = r.error,
        sent_at = case when r.outcome = 'sent' then ${nowIso}::timestamptz end
      from r where d.id = r.id and d.status = 'sending' returning 1),
    del as (
      delete from hub.push_subscriptions
      where endpoint in (select jsonb_array_elements_text(${JSON.stringify(gone)}::jsonb)) returning 1)
    select (select count(*) from upd)::int as updated`);
  return Number(rows[0]?.updated ?? 0);
}

export function dispatchRepo(db: Db): DispatchStore {
  return {
    fanout: (nowIso, limit) => withHubScope(db, system, (tx) => fanout(tx, nowIso, limit)),
    claim: (nowIso, limit, leaseSec) =>
      withHubScope(db, system, (tx) => claim(tx, nowIso, limit, leaseSec)),
    settle: (nowIso, results, gone) =>
      withHubScope(db, system, (tx) => settle(tx, nowIso, results, gone)),
  };
}
