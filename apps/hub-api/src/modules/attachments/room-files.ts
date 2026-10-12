// HUB-FR-44 · HUB-FR-101 · X2b2-R01–R04, R14, D7 · cửa của module `rooms` vào file đính kèm tin phòng (plan X2b2 §7: rooms
// không import repo attachments — depcruise `no-cross-module-repo`). Mọi sai (khác tenant/user, không có, đã gắn, hết hạn,
// đã xoá) → cùng 404 `ATTACHMENT_NOT_FOUND{ids}` theo thứ tự gửi (không lộ tồn tại). Không import `rooms` (no-circular).
import type { AttachMime, AttachmentRef } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { appError } from "../../lib/errors";
import {
  bindRoomFiles,
  type RoomRefRow,
  roomFileRefRows,
  roomSendableFiles,
} from "./room-files.repo";
import { attachmentRefs } from "./room-files.rules";

export { normalizeAttachmentIds } from "./run-files";

type Owner = { tenantId: string; userId: string };

const notFound = (ids: readonly string[]) => appError("ATTACHMENT_NOT_FOUND", { ids: [...ids] });

function missingOf(ids: readonly string[], got: readonly string[]): string[] {
  const have = new Set(got);
  return ids.filter((id) => !have.has(id));
}

/** Hàng (đã sắp theo position) → ref contract; rỗng ⇒ undefined (khoá vắng). */
function refsOf(rows: readonly RoomRefRow[]): AttachmentRef[] | undefined {
  const sorted = [...rows].sort((a, b) => Number(a.position) - Number(b.position));
  return attachmentRefs(
    sorted.map((r) => ({
      id: r.id,
      filename: r.filename,
      mime: r.mime as AttachMime,
      size: Number(r.size),
      purgedAt: r.purged_at === null ? null : new Date(r.purged_at),
    })),
  );
}

/** D7 · kiểm trước (ngoài tx gửi, scope user): thiếu id nào ⇒ 404 `ATTACHMENT_NOT_FOUND{ids}` (thứ tự gửi). */
export async function checkRoomSendable(tx: Tx, o: Owner, ids: readonly string[]): Promise<void> {
  const missing = missingOf(ids, await roomSendableFiles(tx, o, ids));
  if (missing.length > 0) throw notFound(missing);
}

/**
 * R01/D7 · trong tx gửi, ngay sau INSERT tin: gắn `ids` vào tin phòng; số hàng gắn ≠ số id (gửi song song cùng file,
 * sweeper vừa claim) ⇒ 404 (ROLLBACK cả tin). Trả ref theo thứ tự gửi.
 */
export async function bindRoomMessageFiles(
  tx: Tx,
  o: Owner,
  p: { roomId: string; messageId: string; ids: readonly string[] },
): Promise<AttachmentRef[]> {
  const rows = await bindRoomFiles(tx, o, p);
  const missing = missingOf(
    p.ids,
    rows.map((r) => r.id),
  );
  if (missing.length > 0) throw notFound(missing);
  return refsOf(rows) ?? [];
}

/** R14 · ref file theo id tin (một câu); tin không file ⇒ không có khoá trong Map. */
export async function roomFileRefs(
  tx: Tx,
  o: Owner,
  p: { roomId: string; messageIds: readonly string[] },
): Promise<Map<string, AttachmentRef[]>> {
  const out = new Map<string, AttachmentRef[]>();
  if (p.messageIds.length === 0) return out;
  const byMsg = new Map<string, RoomRefRow[]>();
  for (const r of await roomFileRefRows(tx, o, p)) {
    const list = byMsg.get(r.room_message_id) ?? [];
    list.push(r);
    byMsg.set(r.room_message_id, list);
  }
  for (const [id, rows] of byMsg) {
    const refs = refsOf(rows);
    if (refs) out.set(id, refs);
  }
  return out;
}
