// CR-161 · luật thuần kết nối hai công ty (spec §2 R3, R7, R8, R9). SQL trong hàm DEFINER là nơi thi hành thật; file này trùng logic
// để route/UI dùng và test nhanh. Không import I/O. `connected` suy ra từ `hub.partner_links` hai chiều (G1), không có bảng riêng.
import type { ConnectStatus } from "@ai/contracts/pack-contracts";

export type LinkRow = {
  requested_at: string | null;
  accepted_at: string | null;
  blocked_at: string | null;
  connect_requested_at: string | null;
};
/** out = A→B, in = B→A (A = công ty đang thao tác). */
export type LinkPair = { out: LinkRow | null; in: LinkRow | null };
export type { ConnectStatus };

const live = (r: LinkRow | null): boolean =>
  r !== null && r.accepted_at !== null && r.blocked_at === null;

/** R7 · thứ tự ưu tiên: connected > pending_out > pending_in > declined > none. `declined` giữ luật «chặn trước không lộ» (cần requested_at). */
export function connectStatusOf(p: LinkPair): ConnectStatus {
  if (live(p.out) && live(p.in)) return "connected";
  if (p.out?.connect_requested_at) return "pending_out";
  if (p.in?.connect_requested_at) return "pending_in";
  if (p.out?.blocked_at && p.out.requested_at) return "declined";
  return "none";
}

/** R3 · kết quả gửi lời mời (B==A ⇒ 400 xử ở route, không ở đây). */
export function inviteOutcome(
  p: LinkPair,
  listed: boolean,
): "invite" | "accept_reverse" | ConnectStatus | "not_listed" {
  if (!listed) return "not_listed";
  if (connectStatusOf(p) === "connected") return "connected";
  if (p.out?.blocked_at) return "declined";
  if (p.out?.connect_requested_at) return "pending_out";
  if (p.in?.connect_requested_at) return "accept_reverse";
  return "invite";
}

/** R8 · cặp không thứ tự (uuid thường, so sánh chuỗi = so sánh uuid của Postgres). */
export function pairOf(a: string, b: string): { lo: string; hi: string } {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x <= y ? { lo: x, hi: y } : { lo: y, hi: x };
}
