// HUB-NFR-04 · client Redis (ioredis 6.0.0, ADR-0009). Kết nối chặn (XREAD BLOCK) tạo bằng `duplicate()` ở task SSE.
import { Redis } from "ioredis";

export type { Redis };

/** `lazyConnect`: không nối khi tạo, server gọi `connect()`. Không xếp hàng lệnh khi mất kết nối → /health 503 ngay. */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectionName: "hub-api",
  });
}

/** PING có hạn giờ; ném lỗi khi không nhận PONG trong `timeoutMs`. */
export async function pingRedis(redis: Redis, timeoutMs = 1000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("redis ping timeout")), timeoutMs);
  });
  try {
    const pong = await Promise.race([redis.ping(), timeout]);
    if (pong !== "PONG") throw new Error("redis ping: unexpected reply");
  } finally {
    clearTimeout(timer);
  }
}
