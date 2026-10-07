// HUB-FR-99 · HUB-BR-22 · khoá + phát luồng sự kiện theo người dùng `ustream:<user_id>` (X2a plan §7, D11; plan-db §5).
// Dùng chung: `rooms` ghi (SAU commit, mẫu outbox — retry 40P01 không phát đôi), `me-stream` đọc. Lỗi Redis chỉ log
// (không nội dung tin, R24), không ném: tin đã ghi DB, client tự đồng bộ lại bằng `GET /rooms`.
import { type MeStreamEvent, USER_STREAM_MAXLEN } from "@ai/contracts/chat";
import type { Logger } from "./logger";
import type { Redis } from "./redis";

/** Field duy nhất của entry: JSON `{event, data}`. */
export const USER_STREAM_FIELD = "e";
/** D11: 7 ngày; mỗi lần phát gia hạn. */
export const USER_STREAM_TTL_S = 604_800;

/** Sự kiện cần phát + người nhận (`stream.reset` chỉ do phiên đọc tự sinh, không đi qua Redis). */
export type UserEvent = { userIds: string[] } & Exclude<MeStreamEvent, { event: "stream.reset" }>;

export const userStreamKey = (userId: string): string => `ustream:${userId}`;

/** Số lệnh pipeline (XADD + EXPIRE mỗi người nhận) — để kiểm ngân sách plan §10 (≤ 100 lệnh/lần gửi). */
export function publishCommandCount(events: readonly UserEvent[]): number {
  return events.reduce((n, e) => n + e.userIds.length * 2, 0);
}

const roomIdOf = (e: UserEvent): string => e.data.room_id;

/** Một `pipeline()` cho cả lô; không có người nhận ⇒ không gọi Redis. */
export async function publishUserEvents(
  redis: Pick<Redis, "pipeline">,
  events: readonly UserEvent[],
  log: Pick<Logger, "warn">,
): Promise<void> {
  if (publishCommandCount(events) === 0) return;
  const p = redis.pipeline();
  for (const e of events) {
    const body = JSON.stringify({ event: e.event, data: e.data });
    for (const uid of e.userIds) {
      const key = userStreamKey(uid);
      p.xadd(key, "MAXLEN", "~", USER_STREAM_MAXLEN, "*", USER_STREAM_FIELD, body);
      p.expire(key, USER_STREAM_TTL_S);
    }
  }
  try {
    const res = await p.exec();
    if (res?.some(([err]) => err)) throw new Error("pipeline-partial");
  } catch {
    log.warn("ustream-publish-failed", {
      room_id: events[0] && roomIdOf(events[0]),
      n: events.length,
    });
  }
}
