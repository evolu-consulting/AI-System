// X2a · luật thuần của phòng: tên hiển thị, xem trước, "Đã xem", nhóm tin theo ngày (plan-frontend §3).
import type { RoomDetail, RoomMember, RoomMessage, RoomSummary } from "@ai/contracts/chat";

/** Tên hiển thị: nhóm = `name`; DM = tên người kia. */
export function roomTitle(room: Pick<RoomSummary, "kind" | "name" | "peer">): string {
  return room.kind === "group" ? (room.name ?? "") : (room.peer?.display_name ?? room.name ?? "");
}

export type RoomPreview = { who: "you" | "other"; name: string; text: string } | null;

/** Dòng xem trước ở sidebar: "Bạn: …" / "Tên: …" (chuỗi lấy từ i18n `rooms.preview.*`). */
export function previewOf(room: Pick<RoomSummary, "last_message">, myId: string): RoomPreview {
  const m = room.last_message;
  if (!m) return null;
  return {
    who: m.sender.id === myId ? "you" : "other",
    name: m.sender.display_name,
    text: m.preview,
  };
}

/** Người khác đã đọc tới `seq` của tin cuối của tôi; không có tin của tôi → `messageId: null`. */
export function seenBy(
  detail: Pick<RoomDetail, "members">,
  messages: RoomMessage[],
  myId: string,
): { messageId: string | null; readers: RoomMember[] } {
  const last = [...messages]
    .reverse()
    .find((m) => m.sender_type === "user" && m.sender.id === myId);
  if (!last) return { messageId: null, readers: [] };
  return {
    messageId: last.id,
    readers: detail.members.filter((m) => m.id !== myId && m.last_read_seq >= last.seq),
  };
}

/** Khoá ngày địa phương `yyyy-MM-dd` của một mốc ISO. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Nhóm tin (đã sắp seq tăng) thành các cụm liên tiếp cùng ngày. */
export function groupByDay(messages: RoomMessage[]): { day: string; items: RoomMessage[] }[] {
  const out: { day: string; items: RoomMessage[] }[] = [];
  for (const m of messages) {
    const day = dayKey(m.created_at);
    const tail = out[out.length - 1];
    if (tail && tail.day === day) tail.items.push(m);
    else out.push({ day, items: [m] });
  }
  return out;
}

/** Seq lớn nhất, để gửi `POST /read`. */
export function lastSeqOf(messages: RoomMessage[]): number {
  return messages.reduce((mx, m) => Math.max(mx, m.seq), 0);
}

export type DayLabel = { kind: "today" } | { kind: "yesterday" } | { kind: "date"; text: string };

/** Nhãn ngày của một cụm: Hôm nay / Hôm qua / `dd/MM/yyyy` (khoá ngày địa phương `yyyy-MM-dd`). */
export function dayLabelOf(day: string, now: Date): DayLabel {
  const today = dayKey(now.toISOString());
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (day === today) return { kind: "today" };
  if (day === dayKey(yest.toISOString())) return { kind: "yesterday" };
  const [y, m, d] = day.split("-");
  return { kind: "date", text: `${d}/${m}/${y}` };
}

/** Giờ địa phương `HH:mm` của một mốc ISO. */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Tên người đã xem để liệt kê (≤ `max`) + số người còn lại. */
export function readerNames(
  readers: Pick<RoomMember, "display_name">[],
  max = 10,
): { names: string[]; more: number } {
  return {
    names: readers.slice(0, max).map((r) => r.display_name),
    more: Math.max(0, readers.length - max),
  };
}
