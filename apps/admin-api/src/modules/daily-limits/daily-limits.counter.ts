// tenant-quotas · đọc/xoá bộ đếm ngày của hub-api trên Redis (cùng `REDIS_URL`). Đọc: một MGET; đặt lại: một DEL.
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
    reset: async (key) => {
      await redis.del(key);
    },
  };
}
