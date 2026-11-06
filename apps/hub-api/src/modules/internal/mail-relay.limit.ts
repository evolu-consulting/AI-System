// CR-121 c21b · trần số lần gọi `/internal/mail` mỗi phút (chống token dịch vụ bị lạm dụng làm máy phát thư). Cùng mẫu cửa sổ cố định
// một phút với `link-check-limit.redis.ts` / `community-quota.mount.ts`: MỘT pipeline Redis `INCR` + `EXPIRE` (khoá theo phút, dùng
// chung giữa các instance Hub). Redis vắng/lỗi ⇒ đếm TRONG TIẾN TRÌNH (mail quota quan trọng hơn việc đếm chung; vẫn có trần).
import type { Redis } from "../../lib/redis";

/** Mỗi lần gọi = một thư gửi tới ≤ 50 người nhận; 30 lần/phút dư cho cảnh báo quota, chặn lạm dụng. */
export const MAIL_RELAY_PER_MINUTE = 30;
const KEY_PREFIX = "q:hub:mail-relay:";

/** `true` = còn trong trần (đã tính lần này); `false` = vượt trần. */
export type MailRelayLimit = () => Promise<boolean>;

export function mailRelayLimit(o: {
  redis?: Redis;
  limit?: number;
  now?: () => Date;
}): MailRelayLimit {
  const limit = o.limit ?? MAIL_RELAY_PER_MINUTE;
  const now = o.now ?? (() => new Date());
  let local = { minute: -1, n: 0 };
  return async () => {
    const minute = Math.floor(now().getTime() / 60_000);
    if (o.redis) {
      try {
        const key = `${KEY_PREFIX}${minute}`;
        const out = await o.redis.pipeline().incr(key).expire(key, 120).exec();
        if (!out || out[0]?.[0]) throw new Error("redis");
        return Number(out[0]?.[1]) <= limit;
      } catch {
        // rơi xuống đếm trong tiến trình
      }
    }
    if (local.minute !== minute) local = { minute, n: 0 };
    local.n++;
    return local.n <= limit;
  };
}
