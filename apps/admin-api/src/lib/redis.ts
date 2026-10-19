// L1 (TECH-DEBT #224) · client Redis của admin-api (ioredis như hub-api, ADR-0009) — chỉ cho giới hạn đăng nhập.
// Không xếp hàng lệnh khi mất kết nối + timeout lệnh ngắn ⇒ Redis chết/treo thì login 503 ngay (đóng an toàn), không treo.
import { Redis } from "ioredis";

export type { Redis };

export function createRedis(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 500,
    connectionName: "admin-api",
  });
}
