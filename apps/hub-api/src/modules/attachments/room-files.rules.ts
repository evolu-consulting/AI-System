// HUB-FR-44 · HUB-FR-101 · HUB-BR-21 · HUB-BR-22 · X2b2-R05–R07, R16, D3, D9 · luật thuần file đính kèm trong phòng
// (plan X2b2 §8). Không I/O.
import type { AttachMime, AttachmentRef } from "@ai/contracts/chat";
import { RUN_FILES_MAX, RUN_FILES_MAX_BYTES } from "./run-files.rules";

/** Hàng file của cửa sổ run phòng (plan §7 `roomRunFileRows`; chỉ file chưa purge). */
export type RoomFileRow = {
  id: string;
  roomMessageId: string;
  seq: number;
  position: number;
  safeName: string;
  mime: AttachMime;
  size: number;
  sha256: string;
};

function roomFileOrder(trigger: string) {
  return (a: RoomFileRow, b: RoomFileRow): number => {
    const ta = a.roomMessageId === trigger ? 1 : 0;
    const tb = b.roomMessageId === trigger ? 1 : 0;
    if (ta !== tb) return tb - ta;
    if (a.seq !== b.seq) return b.seq - a.seq;
    return a.position - b.position;
  };
}

/** R07 · tin gọi trước; rồi seq giảm; trong tin position tăng; dừng ở file thứ 11 hoặc khi tổng > 100 MiB. */
export function pickRoomRunFiles(
  rows: readonly RoomFileRow[],
  o: { triggerMessageId: string },
): RoomFileRow[] {
  const sorted = [...rows].sort(roomFileOrder(o.triggerMessageId));
  const out: RoomFileRow[] = [];
  let total = 0;
  for (const r of sorted) {
    if (out.length >= RUN_FILES_MAX || total + r.size > RUN_FILES_MAX_BYTES) break;
    total += r.size;
    out.push(r);
  }
  return out;
}

/** R07 · id tin cửa sổ: [trigger, ...main, ...thread], bỏ trùng, giữ thứ tự xuất hiện đầu tiên. */
export function roomFileWindow(p: {
  triggerId: string;
  main: readonly { id: string }[];
  thread?: readonly { id: string }[];
}): string[] {
  const all = [p.triggerId, ...p.main.map((m) => m.id), ...(p.thread ?? []).map((m) => m.id)];
  return [...new Set(all)];
}

/** R05/R06 · gương của câu đọc (plan §6.4). room ≠ null ⇒ roomMember ∧ ¬roomDeleted; room = null ⇒ owner ∧ ¬conversationDeleted. */
export function canReadAttachment(
  a: { roomId: string | null; ownerId: string; conversationDeleted: boolean },
  v: { userId: string; roomMember: boolean; roomDeleted: boolean },
): boolean {
  if (a.roomId !== null) return v.roomMember && !v.roomDeleted;
  return a.ownerId === v.userId && !a.conversationDeleted;
}

/** D3 · "chưa gắn" = messageId null ∧ roomId null. */
export function isUnbound(a: { messageId: string | null; roomId: string | null }): boolean {
  return a.messageId === null && a.roomId === null;
}

/** Hàng → AttachmentRef[] (available = purgedAt null); rỗng ⇒ undefined (khoá vắng). */
export function attachmentRefs(
  rows: readonly {
    id: string;
    filename: string;
    mime: AttachMime;
    size: number;
    purgedAt: Date | null;
  }[],
): AttachmentRef[] | undefined {
  if (rows.length === 0) return undefined;
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mime: r.mime,
    size: r.size,
    available: r.purgedAt === null,
  }));
}
