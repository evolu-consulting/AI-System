// CR-182 · R7: trần kiểm tệp theo NGƯỜI DÙNG (máy chủ băm tệp tới 20 MiB ⇒ không để một người làm nghẽn). Cửa sổ cố định một phút: MỘT pipeline
// Redis `INCR` + `EXPIRE` (khoá `q:contracts:vf:<tenant>:<user>:<phút>`). Vượt ⇒ 429 `VERIFY_FILE_LIMIT`; Redis vắng/lỗi ⇒ 503 (đóng an toàn).
import type { Redis } from "ioredis";
import { AppError } from "../../../../lib/errors";
import { QUOTA_KEY_PREFIX } from "./upload-counter.redis";

export const VERIFY_FILES_PER_MINUTE = 10;

export type VerifyFileLimit = (tenantId: string, userId: string) => Promise<void>;

export function verifyFileLimit(o: {
  redis?: Redis;
  limit: number;
  now?: () => Date;
}): VerifyFileLimit {
  const now = o.now ?? (() => new Date());
  return async (tenantId, userId) => {
    if (!o.redis) throw new AppError("VERIFY_FILE_UNAVAILABLE", 503, "Verify limiter unavailable");
    const key = `${QUOTA_KEY_PREFIX}vf:${tenantId}:${userId}:${Math.floor(now().getTime() / 60_000)}`;
    let n: number;
    try {
      const out = await o.redis.pipeline().incr(key).expire(key, 120).exec();
      if (!out || out[0]?.[0]) throw new Error("redis");
      n = Number(out[0]?.[1]);
    } catch {
      throw new AppError("VERIFY_FILE_UNAVAILABLE", 503, "Verify limiter unavailable");
    }
    if (n > o.limit)
      throw new AppError("VERIFY_FILE_LIMIT", 429, "Quá nhiều lần kiểm tệp, thử lại sau một phút", {
        limit: o.limit,
      });
  };
}
