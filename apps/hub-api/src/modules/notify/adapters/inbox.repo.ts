// N3-FR-04 · N3-FR-09 · câu SQL chuông/tùy chọn/đăng ký push của CHÍNH người dùng. Scope `user` (RLS: tenant + user của token) và
// lọc tường minh `tenant_id`/`user_id` ngoài RLS. Ngoại lệ có chủ đích: đăng ký push dùng scope system với tenant/user lấy từ
// token — một endpoint (trình duyệt) có thể đang gắn với người dùng trước trên cùng máy; RLS user không thấy hàng đó để chuyển.
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { InboxStore, NotificationItem, PrefsView, Who } from "../application/ports";
import { effectiveLeadDays } from "../domain/notify.rules";

type Row = Omit<NotificationItem, "created_at" | "seq"> & {
  created_at: Date | string;
  seq: string | number;
};

const userScope = (who: Who) =>
  ({ kind: "user", tenantId: who.tenantId, userId: who.userId }) as const;

async function listTx(tx: Tx, who: Who, limit: number, before: number | null) {
  const cond = before === null ? sql`` : sql`and n.seq < ${before}`;
  const rows = await tx.execute<Row>(sql`
    select n.id, n.seq, n.source, n.kind, n.title, n.body, n.link, n.created_at, (n.read_at is not null) as read
    from hub.notifications n
    where n.tenant_id = ${who.tenantId} and n.user_id = ${who.userId} ${cond}
    order by n.seq desc limit ${limit}`);
  const cnt = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from hub.notifications
    where tenant_id = ${who.tenantId} and user_id = ${who.userId} and read_at is null`);
  return {
    items: rows.map((r) => ({
      ...r,
      seq: Number(r.seq),
      created_at: new Date(r.created_at).toISOString(),
    })),
    unread: Number(cnt[0]?.n ?? 0),
  };
}

async function markReadTx(tx: Tx, who: Who, ids: readonly string[] | "all") {
  const which =
    ids === "all"
      ? sql`true`
      : sql`n.id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`;
  const res = await tx.execute<{ id: string }>(sql`
    update hub.notifications n set read_at = now()
    where n.tenant_id = ${who.tenantId} and n.user_id = ${who.userId} and n.read_at is null and ${which}
    returning n.id`);
  return res.length;
}
type PrefRow = {
  email: boolean;
  push: boolean;
  remind_days: number[] | null;
  price_alerts: boolean;
  include_managed: boolean;
  tenant_days: number[];
};

/** Tùy chọn hiệu lực của chính người dùng (một câu; mặc định khi chưa có hàng) + mặc định mốc nhắc của tenant. */
async function prefsTx(tx: Tx, who: Who): Promise<PrefsView> {
  const [r] = await tx.execute<PrefRow>(sql`
    select coalesce(p.email, true) as email, coalesce(p.push, true) as push, p.remind_days,
      coalesce(p.price_alerts, true) as price_alerts, coalesce(p.include_managed, false) as include_managed,
      notify.tenant_remind_days() as tenant_days
    from (select 1) o left join hub.notify_prefs p on p.tenant_id = ${who.tenantId} and p.user_id = ${who.userId}`);
  const days = r?.tenant_days ?? null;
  const own = r?.remind_days ?? null;
  return {
    email: r?.email ?? true,
    push: r?.push ?? true,
    remind_days: effectiveLeadDays(own, days),
    remind_days_custom: own !== null,
    remind_days_default: effectiveLeadDays(null, days),
    price_alerts: r?.price_alerts ?? true,
    include_managed: r?.include_managed ?? false,
  };
}

export function inboxRepo(db: Db): InboxStore {
  return {
    list: (who, limit, before) =>
      withHubScope(db, userScope(who), (tx) => listTx(tx, who, limit, before)),
    markRead: (who, ids) => withHubScope(db, userScope(who), (tx) => markReadTx(tx, who, ids)),

    prefs: (who) => withHubScope(db, userScope(who), (tx) => prefsTx(tx, who)),

    setPrefs: (who, p) =>
      withHubScope(db, userScope(who), async (tx) => {
        const cur = await prefsTx(tx, who);
        const days =
          p.remind_days === undefined
            ? cur.remind_days_custom
              ? cur.remind_days
              : null
            : p.remind_days;
        // Mảng mốc qua tham số jsonb (một câu cố định); null ⇒ cột NULL = mặc định tenant.
        await tx.execute(sql`
          insert into hub.notify_prefs (tenant_id, user_id, email, push, remind_days, price_alerts, include_managed)
          values (${who.tenantId}, ${who.userId}, ${p.email}, ${p.push},
            case when ${days === null}::boolean then null
              else array(select jsonb_array_elements_text(${JSON.stringify(days ?? [])}::jsonb)::int) end,
            ${p.price_alerts ?? cur.price_alerts}, ${p.include_managed ?? cur.include_managed})
          on conflict (tenant_id, user_id) do update set email = excluded.email, push = excluded.push,
            remind_days = excluded.remind_days, price_alerts = excluded.price_alerts,
            include_managed = excluded.include_managed, updated_at = now()`);
        return prefsTx(tx, who);
      }),

    // Thông báo thử đi đúng đường thật (fanout ⇒ push theo đăng ký); khoá idempotency theo cửa sổ 30 s chống bấm dồn.
    sendTest: (who) =>
      withHubScope(db, userScope(who), async (tx) => {
        const row = {
          user_id: who.userId,
          kind: "system.test",
          title: "Thông báo thử",
          body: "Đây là thông báo thử. Nếu bạn thấy nó, thông báo đẩy đã hoạt động.",
          link: "/notifications",
          dedup_key: `test:${Math.floor(Date.now() / 30_000)}`,
        };
        const r = await tx.execute<{ n: number }>(
          sql`select notify.enqueue('hub', ${JSON.stringify([row])}::jsonb) as n`,
        );
        return Number(r[0]?.n ?? 0);
      }),

    subscribe: (who, s) =>
      withHubScope(db, { kind: "system" }, async (tx) => {
        await tx.execute(sql`
          insert into hub.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
          values (${who.tenantId}, ${who.userId}, ${s.endpoint}, ${s.p256dh}, ${s.auth})
          on conflict (endpoint) do update set tenant_id = excluded.tenant_id, user_id = excluded.user_id,
            p256dh = excluded.p256dh, auth = excluded.auth`);
      }),

    unsubscribe: (who, endpoint) =>
      withHubScope(db, userScope(who), async (tx) => {
        const r = await tx.execute<{ id: string }>(sql`
          delete from hub.push_subscriptions
          where tenant_id = ${who.tenantId} and user_id = ${who.userId} and endpoint = ${endpoint} returning id`);
        return r.length;
      }),
  };
}
