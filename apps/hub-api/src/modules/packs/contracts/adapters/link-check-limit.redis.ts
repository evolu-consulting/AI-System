// HD8-FR-05 · review HD78 #3: trần mở link báo giá theo NGƯỜI DÙNG (máy chủ đi mở URL ngoài ⇒ không để một người dùng làm máy quét).
// Cửa sổ cố định một phút: MỘT pipeline Redis `INCR` + `EXPIRE` (khoá `q:contracts:lc:<tenant>:<user>:<phút>`). Vượt ⇒ 429
// `LINK_CHECK_LIMIT`; Redis vắng/lỗi ⇒ 503 (đóng an toàn như D-17 của quota tải lên).
import type { Redis } from "ioredis";
import { AppError } from "../../../../lib/errors";
import { QUOTA_KEY_PREFIX } from "./upload-counter.redis";

export const LINK_CHECKS_PER_MINUTE = 10;

export type LinkCheckLimit = (tenantId: string, userId: string) => Promise<void>;

export function linkCheckLimit(o: {
  redis?: Redis;
  limit: number;
  now?: () => Date;
}): LinkCheckLimit {
  const now = o.now ?? (() => new Date());
  return async (tenantId, userId) => {
    if (!o.redis)
      throw new AppError("LINK_CHECK_UNAVAILABLE", 503, "Link check limiter unavailable");
    const minute = Math.floor(now().getTime() / 60_000);
    const key = `${QUOTA_KEY_PREFIX}lc:${tenantId}:${userId}:${minute}`;
    let n: number;
    try {
      const out = await o.redis.pipeline().incr(key).expire(key, 120).exec();
      if (!out || out[0]?.[0]) throw new Error("redis");
      n = Number(out[0]?.[1]);
    } catch {
      throw new AppError("LINK_CHECK_UNAVAILABLE", 503, "Link check limiter unavailable");
    }
    if (n > o.limit)
      throw new AppError("LINK_CHECK_LIMIT", 429, "Quá nhiều lần kiểm link, thử lại sau một phút", {
        limit: o.limit,
      });
  };
}
