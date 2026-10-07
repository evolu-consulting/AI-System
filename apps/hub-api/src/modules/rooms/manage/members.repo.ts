// HUB-FR-97 · HUB-FR-98 · truy vấn thành viên phòng: thêm/bớt/rời/chuyển chủ/ẩn DM (X2a plan-db §5 hàng Thêm/Bớt/Chuyển/Ẩn,
// §6). Chạy trong `withHubScope({kind:"user"})`; mọi câu lọc `tenant_id` tường minh, RLS là lưới. Thêm/bớt/rời/chuyển chủ
// chỉ gọi SAU `lockFor` (khoá hàng `rooms` trước `room_members`); ẩn DM chỉ chạm hàng của mình, không xin khoá `rooms`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Me } from "./rooms.repo";

type Num = number | string;
/** id đã qua zod/kiểm thành viên (uuid) ⇒ literal mảng Postgres an toàn (mẫu `rooms.repo`). */
const uuidArr = (ids: readonly string[]): string => `{${ids.join(",")}}`;

/**
 * Thêm (hoặc thêm lại người đã rời) với vai `member`, mốc đọc = `last_seq` lúc vào (D6), bỏ ẩn. Người đang là thành viên
 * không bị đụng (`WHERE left_at IS NOT NULL`) — service đã lọc trước dưới khoá.
 */
export async function addMembers(
  tx: Tx,
  me: Me,
  roomId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx.execute(sql`
    insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at, last_read_seq)
    select r.id, r.tenant_id, u.id, 'member', date_trunc('milliseconds', now()), r.last_seq
    from hub.rooms r, unnest(${uuidArr(ids)}::uuid[]) as u(id)
    where r.id = ${roomId} and r.tenant_id = ${me.tenantId}
    on conflict (room_id, user_id) do update
      set role = 'member', joined_at = excluded.joined_at, left_at = null, hidden_at = null,
          last_read_seq = excluded.last_read_seq
      where hub.room_members.left_at is not null`);
}

/** Bớt / rời: đặt `left_at` (`clock_timestamp()` sau khi giữ khoá phòng ⇒ không sớm hơn tin vừa gửi trước đó, P07). */
export async function markLeft(tx: Tx, me: Me, roomId: string, userId: string): Promise<void> {
  await tx.execute(sql`
    update hub.room_members set left_at = date_trunc('milliseconds', clock_timestamp())
    where room_id = ${roomId} and tenant_id = ${me.tenantId} and user_id = ${userId} and left_at is null`);
}

/** D9 · một câu `CASE` (EXCLUDE đúng 1 chủ hoãn tới commit ⇒ thứ tự hàng không quan trọng). */
export async function transferOwner(tx: Tx, me: Me, roomId: string, to: string): Promise<void> {
  await tx.execute(sql`
    update hub.room_members
    set role = case user_id when ${to}::uuid then 'owner' else 'member' end
    where room_id = ${roomId} and tenant_id = ${me.tenantId} and left_at is null
      and user_id in (${me.userId}::uuid, ${to}::uuid)`);
}

/** R07 · ẩn DM cho mình. Đã ẩn ⇒ null (không đổi, không sự kiện); vừa ẩn ⇒ chưa đọc của phòng. */
export async function hideSelf(tx: Tx, me: Me, roomId: string): Promise<{ unread: number } | null> {
  const [row] = await tx.execute<{ unread: Num }>(sql`
    update hub.room_members m set hidden_at = date_trunc('milliseconds', now())
    from hub.rooms r
    where m.room_id = ${roomId} and m.tenant_id = ${me.tenantId} and m.user_id = ${me.userId}
      and m.left_at is null and m.hidden_at is null and r.id = m.room_id and r.tenant_id = m.tenant_id
    returning greatest(r.last_seq - m.last_read_seq, 0) as unread`);
  return row ? { unread: Number(row.unread) } : null;
}
