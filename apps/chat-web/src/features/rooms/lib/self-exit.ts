// HUB-FR-98 · hành động của chính mình (xoá / rời nhóm) cũng làm `room.deleted` / `member_removed` về lại tab này
// → `useRoomLost` bỏ qua đúng một sự kiện để không hiện toast "bị xoá / không còn trong nhóm" thừa.
const TTL_MS = 10_000;
const marks = new Set<string>();

export function markSelfExit(roomId: string): void {
  marks.add(roomId);
  setTimeout(() => marks.delete(roomId), TTL_MS);
}

export function unmarkSelfExit(roomId: string): void {
  marks.delete(roomId);
}

/** true nếu sự kiện mất phòng này do chính mình gây ra (đồng thời xoá dấu). */
export function consumeSelfExit(roomId: string): boolean {
  return marks.delete(roomId);
}
