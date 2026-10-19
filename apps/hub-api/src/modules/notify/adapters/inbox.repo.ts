// N3-FR-04 · N3-FR-09 · câu SQL chuông/tùy chọn/đăng ký push của CHÍNH người dùng. Scope `user` (RLS: tenant + user của token) và
// lọc tường minh `tenant_id`/`user_id` ngoài RLS. Ngoại lệ có chủ đích: đăng ký push dùng scope system với tenant/user lấy từ
// token — một endpoint (trình duyệt) có thể đang gắn với người dùng trước trên cùng máy; RLS user không thấy hàng đó để chuyển.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { InboxStore, NotificationItem, Who } from "../application/ports";

type Row = Omit<NotificationItem, "created_at" | "seq"> & {
  created_at: Date | string;
  seq: string | number;
};

const userScope = (who: Who) =>
  ({ kind: "user", tenantId: who.tenantId, userId: who.userId }) as const;

export function inboxRepo(db: Db): InboxStore {
  return {
    list: (who, limit, before) =>
      withHubScope(db, userScope(who), async (tx) => {
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
      }),

    markRead: (who, ids) =>
      withHubScope(db, userScope(who), async (tx) => {
        const which =
          ids === "all"
            ? sql`true`
            : sql`n.id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`;
        const res = await tx.execute<{ id: string }>(sql`
          update hub.notifications n set read_at = now()
          where n.tenant_id = ${who.tenantId} and n.user_id = ${who.userId} and n.read_at is null and ${which}
          returning n.id`);
        return res.length;
      }),

    prefs: (who) =>
      withHubScope(db, userScope(who), async (tx) => {
        const r = await tx.execute<{ email: boolean; push: boolean }>(sql`
          select email, push from hub.notify_prefs where tenant_id = ${who.tenantId} and user_id = ${who.userId}`);
        return { email: r[0]?.email ?? true, push: r[0]?.push ?? true };
      }),

    setPrefs: (who, p) =>
      withHubScope(db, userScope(who), async (tx) => {
        await tx.execute(sql`
          insert into hub.notify_prefs (tenant_id, user_id, email, push) values (${who.tenantId}, ${who.userId}, ${p.email}, ${p.push})
          on conflict (tenant_id, user_id) do update set email = excluded.email, push = excluded.push, updated_at = now()`);
        return p;
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
