// HUB-FR-44 · HUB-FR-101 · X2b2-R01–R04, D2, D3, D7 · SQL file đính kèm tin phòng (plan X2b2 §7). Scope `user` (người gửi /
// người xem); luôn lọc `tenant_id` tường minh, RLS 0023 lọc thêm lớp 2 (chủ + thành viên phòng).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { uuidArray } from "./attachments.repo";

type Owner = { tenantId: string; userId: string };

/** Hàng ref theo tin (`roomFileRefs`, `bindRoomFiles` returning). */
export type RoomRefRow = {
  room_message_id: string;
  id: string;
  filename: string;
  mime: string;
  size: string | number;
  purged_at: Date | string | null;
  position: number;
};

/** D7 · id gửi được vào tin phòng: của chủ, upload, chưa gắn (D3), chưa purge, < 24 giờ. Trả id có. */
export async function roomSendableFiles(
  tx: Tx,
  o: Owner,
  ids: readonly string[],
): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`select id from hub.attachments
    where id = any(${uuidArray(ids)}::uuid[]) and tenant_id = ${o.tenantId} and user_id = ${o.userId}
      and origin = 'upload' and message_id is null and room_id is null and purged_at is null
      and created_at > now() - interval '24 hours'`);
  return rows.map((r) => r.id);
}

/** R01/D7 · gắn vào tin phòng (trong tx gửi, sau INSERT tin); điều kiện như `roomSendableFiles`. Trả hàng gắn được. */
export async function bindRoomFiles(
  tx: Tx,
  o: Owner,
  p: { roomId: string; messageId: string; ids: readonly string[] },
): Promise<RoomRefRow[]> {
  const ids = uuidArray(p.ids);
  return tx.execute<RoomRefRow>(sql`update hub.attachments a
    set room_id = ${p.roomId}, room_message_id = ${p.messageId}, bound_at = now(),
      position = array_position(${ids}::uuid[], a.id) - 1
    where a.id = any(${ids}::uuid[]) and a.tenant_id = ${o.tenantId} and a.user_id = ${o.userId}
      and a.origin = 'upload' and a.message_id is null and a.room_id is null and a.purged_at is null
      and a.created_at > now() - interval '24 hours'
    returning a.room_message_id, a.id, a.filename, a.mime, a.size, a.purged_at, a.position`);
}

/** R14 · ref file của các tin (một câu / trang; ≤ 100 tin × 10), thứ tự (tin, position). */
export async function roomFileRefRows(
  tx: Tx,
  o: Owner,
  p: { roomId: string; messageIds: readonly string[] },
): Promise<RoomRefRow[]> {
  return tx.execute<RoomRefRow>(sql`select room_message_id, id, filename, mime, size, purged_at, position
    from hub.attachments
    where room_message_id = any(${uuidArray(p.messageIds)}::uuid[]) and room_id = ${p.roomId}
      and tenant_id = ${o.tenantId}
    order by room_message_id, position`);
}
