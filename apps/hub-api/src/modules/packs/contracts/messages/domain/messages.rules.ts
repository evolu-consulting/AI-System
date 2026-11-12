// CR-132 · HD-MSG-01..12 · Tin nhắn Sổ Hợp Tác — luật thuần (không đọc DB, không giờ hệ thống): khoá 1-1, quyền chủ nhóm, chuyển chủ khi
// chủ rời, trần nhóm, kẹp «đã đọc», danh sách người đã xem, tin rỗng. Chữ ký theo spec §4; use case (M3) gọi, RLS là lưới chặn cuối.
import {
  type ConvKind,
  type MemberRole,
  MSG_GROUP_MAX,
  MSG_UNREAD_CONV_CAP,
  MSG_UNREAD_TOTAL_MAX,
} from "@ai/contracts/pack-contracts";

/** Khoá duy nhất của hội thoại 1-1: hai id (không phân biệt hoa/thường, thứ tự) ⇒ cùng một khoá. Khớp `UNIQUE (tenant_id, dm_key)`. */
export function dmKey(a: string, b: string): string {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x <= y ? `${x}:${y}` : `${y}:${x}`;
}

/** Đổi tên nhóm / thêm người: chỉ chủ nhóm của hội thoại nhóm (1-1 cố định). */
export function canEditGroup(c: { kind: ConvKind }, role: MemberRole): boolean {
  return c.kind === "group" && role === "owner";
}

/** Bớt thành viên: nhóm, và hoặc tự rời (target = mình) hoặc là chủ nhóm. 1-1 không rời được. */
export function canRemoveMember(
  c: { kind: ConvKind },
  actor: { id: string; role: MemberRole },
  targetId: string,
): boolean {
  return c.kind === "group" && (actor.id === targetId || actor.role === "owner");
}

const ms = (d: Date | string): number => (d instanceof Date ? d.getTime() : Date.parse(d));

/** Chủ rời nhóm: người còn lại vào sớm nhất thành chủ (hoà ⇒ id nhỏ hơn); không còn ai ⇒ null (xoá hội thoại). */
export function nextOwner(
  rest: { user_id: string; role: MemberRole; joined_at: Date | string }[],
): string | null {
  let best: { user_id: string; t: number } | null = null;
  for (const m of rest) {
    const t = ms(m.joined_at);
    if (!best || t < best.t || (t === best.t && m.user_id < best.user_id))
      best = { user_id: m.user_id, t };
  }
  return best ? best.user_id : null;
}

/** Nhóm không quá 50 người sau khi thêm. */
export function groupSizeOk(current: number, adding: number): boolean {
  return current + adding <= MSG_GROUP_MAX;
}

/** Mốc «đã đọc» chỉ tiến, không vượt tin cuối: `max(current, min(requested, lastSeq))`. */
export function clampRead(current: number, requested: number, lastSeq: number): number {
  return Math.max(current, Math.min(requested, lastSeq));
}

/** Những người KHÁC mình đã đọc tới `seq` trở lên (để hiện «Đã xem» / «Đã xem: n»). */
export function seenBy(
  members: { user_id: string; last_read_seq: number }[],
  me: string,
  seq: number,
): string[] {
  return members.filter((m) => m.user_id !== me && m.last_read_seq >= seq).map((m) => m.user_id);
}

/** Tin không có chữ (sau trim) và không có tệp ⇒ rỗng (400 `MSG_EMPTY`). */
export function messageEmpty(body: string, fileCount: number): boolean {
  return body.trim().length === 0 && fileCount === 0;
}

/** Kẹp số chưa đọc trên dây: mỗi hội thoại 100 (client hiện «99+» khi > 99), tổng 999. */
export function capUnread(n: number, scope: "conversation" | "total"): number {
  const max = scope === "conversation" ? MSG_UNREAD_CONV_CAP : MSG_UNREAD_TOTAL_MAX;
  return Math.max(0, Math.min(n, max));
}
