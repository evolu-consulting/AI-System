// CR-050 · luật thuần của sidebar 3 mục: "Nhóm" (phòng nhóm) · "Users" (DM đã có + người trong danh bạ chưa nhắn).
import type { DirectoryUser, RoomSummary } from "@ai/contracts/chat";
import { roomTitle } from "~/features/rooms/lib/room-logic";

export type PersonRow = { kind: "dm"; room: RoomSummary } | { kind: "person"; user: DirectoryUser };

const has = (s: string | undefined, term: string) => !!s && s.toLowerCase().includes(term);

/** Phòng nhóm khớp từ khoá (giữ thứ tự hoạt động của list). */
export function groupRows(rooms: readonly RoomSummary[], q: string): RoomSummary[] {
  const term = q.trim().toLowerCase();
  return rooms.filter((r) => r.kind === "group" && (!term || has(roomTitle(r), term)));
}

/**
 * DM đã có (thứ tự hoạt động của list) rồi người trong danh bạ chưa có DM (đang hoạt động, khác mình, theo tên).
 * Từ khoá khớp tên hiển thị hoặc username.
 */
export function peopleRows(
  rooms: readonly RoomSummary[],
  people: readonly DirectoryUser[],
  myId: string,
  q: string,
): PersonRow[] {
  const term = q.trim().toLowerCase();
  const dms = rooms.filter(
    (r) => r.kind === "dm" && (!term || has(roomTitle(r), term) || has(r.peer?.username, term)),
  );
  const peers = new Set(rooms.filter((r) => r.kind === "dm").map((r) => r.peer?.id));
  const others = people
    .filter((u) => u.active && u.id !== myId && !peers.has(u.id))
    .filter((u) => !term || has(u.display_name, term) || has(u.username, term))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "vi"));
  return [
    ...dms.map((room) => ({ kind: "dm" as const, room })),
    ...others.map((user) => ({ kind: "person" as const, user })),
  ];
}

/** Tổng chưa đọc của một tập phòng (huy hiệu ở tiêu đề mục). */
export function unreadOf(rooms: readonly RoomSummary[]): number {
  return rooms.reduce((n, r) => n + r.unread, 0);
}
