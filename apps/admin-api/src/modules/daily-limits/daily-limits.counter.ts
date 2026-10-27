// tenant-quotas · đọc/đặt lại bộ đếm ngày của hub-api trên Redis (cùng `REDIS_URL`). Đọc: một MGET; đặt lại: một SET 0 KEEPTTL.
import type { Redis } from "../../lib/redis";

export type DailyCounterStore = {
  /** Giá trị các khoá (vắng ⇒ 0). Lỗi ⇒ ném. */
  read(keys: readonly string[]): Promise<number[]>;
  /** Xoá khoá (đặt lại về 0). Lỗi ⇒ ném. */
  reset(key: string): Promise<void>;
};

export function redisDailyCounter(redis: Redis): DailyCounterStore {
  return {
    read: async (keys) => {
      if (keys.length === 0) return [];
      const vals = await redis.mget(...keys);
      return vals.map((v) => {
        const n = Number(v ?? 0);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
      });
    },
    // Về 0 nhưng giữ khoá + TTL (không DEL): lượt đang giữ rồi hoàn (DECR) không tạo khoá mới không hạn / không âm.
    reset: async (key) => {
      await redis.set(key, "0", "KEEPTTL");
    },
  };
}
