// CR-121 D-6 · node `notify`: MỘT câu trong tx của bước — tìm người nhận (user còn dùng được của CÔNG TY CỦA RUN: người bắt đầu /
// user ở input / thành viên Group theo mã) rồi ghi vào hàng gửi `hub.notifications` (`notify.enqueue_run_notices`, 0101). Không
// gọi mạng: mail/push do vòng gửi của module notify (thử lại theo backoff sẵn có). Trùng (retry/sweep) ⇒ `dedup_key` chặn.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type RunNotice = {
  runId: string;
  tenantId: string;
  userIds: readonly string[];
  groupKeys: readonly string[];
  kind: string;
  title: string;
  body: string;
  dedupKey: string;
};

/** `recipients` = số người nhận hợp lệ; `inserted` = số thông báo chèn mới (0 khi chạy lại cùng khoá). */
export async function enqueueRunNotice(
  tx: Tx,
  n: RunNotice,
): Promise<{ recipients: number; inserted: number }> {
  const rows = await tx.execute<{ recipients: number; inserted: number }>(sql`
    with r as (
      select u.id from admin.users u
      where u.tenant_id = ${n.tenantId}::uuid and u.active and not u.locked_by_tenant
        and (u.id in (select jsonb_array_elements_text(${JSON.stringify(n.userIds)}::jsonb)::uuid)
          or u.id in (select gm.user_id from admin.group_members gm
            join admin.groups g on g.id = gm.group_id and g.tenant_id = gm.tenant_id
            where gm.tenant_id = ${n.tenantId}::uuid
              and g.key in (select jsonb_array_elements_text(${JSON.stringify(n.groupKeys)}::jsonb))))
    )
    select (select count(*) from r)::int as recipients,
      notify.enqueue_run_notices((select coalesce(jsonb_agg(jsonb_build_object('run_id', ${n.runId}::uuid,
        'user_id', r.id, 'kind', ${n.kind}::text, 'title', ${n.title}::text, 'body', ${n.body}::text,
        'dedup_key', ${n.dedupKey}::text) order by r.id), '[]'::jsonb) from r)) as inserted`);
  const r = rows[0];
  return { recipients: Number(r?.recipients ?? 0), inserted: Number(r?.inserted ?? 0) };
}
