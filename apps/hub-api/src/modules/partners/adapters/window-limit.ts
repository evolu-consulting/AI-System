// CR-124 · q5 · hạn mức cửa sổ cố định cho trang công khai (theo token / theo IP). Cùng mẫu `mail-relay.limit.ts`: MỘT pipeline Redis
// `INCR` + `EXPIRE` (dùng chung giữa các instance Hub); Redis vắng/lỗi ⇒ đếm TRONG TIẾN TRÌNH (vẫn có trần). Khoá chỉ chứa băm/IP, không có token rõ.
import type { Redis } from "../../../lib/redis";

export type LimitVerdict = { ok: boolean; retryAfterS: number };
export type WindowLimit = {
  /** Tính thêm 1 lượt vào `key`; `ok=false` khi vượt `limit` trong cửa sổ `windowS`. */
  hit(key: string, limit: number, windowS: number): Promise<LimitVerdict>;
  /** Chỉ đọc số lượt hiện có (không tính thêm). */
  count(key: string, windowS: number): Promise<number>;
};

const PREFIX = "q:hub:partner-public:";

export function windowLimit(o: { redis?: Redis | undefined; now?: () => Date }): WindowLimit {
  const now = o.now ?? (() => new Date());
  const local = new Map<string, number>();
  const slot = (windowS: number) => {
    const t = now().getTime();
    const w = Math.floor(t / (windowS * 1000));
    return { w, retryAfterS: Math.max(1, Math.ceil(((w + 1) * windowS * 1000 - t) / 1000)) };
  };
  const mem = (key: string, windowS: number, inc: number): number => {
    // Trần bộ nhớ khi không có Redis: bỏ cửa sổ CŨ NHẤT (Map giữ thứ tự chèn), không xoá sạch (xoá sạch = reset hạn mức của mọi người).
    while (local.size >= 5000) {
      const oldest = local.keys().next().value;
      if (oldest === undefined) break;
      local.delete(oldest);
    }
    const k = `${key}:${slot(windowS).w}`;
    const n = (local.get(k) ?? 0) + inc;
    local.set(k, n);
    return n;
  };
  return {
    async hit(key, limit, windowS) {
      const { w, retryAfterS } = slot(windowS);
      if (o.redis) {
        try {
          const k = `${PREFIX}${key}:${w}`;
          const out = await o.redis
            .pipeline()
            .incr(k)
            .expire(k, windowS + 5)
            .exec();
          if (!out || out[0]?.[0]) throw new Error("redis");
          return { ok: Number(out[0]?.[1]) <= limit, retryAfterS };
        } catch {
          // rơi xuống đếm trong tiến trình
        }
      }
      return { ok: mem(key, windowS, 1) <= limit, retryAfterS };
    },
    async count(key, windowS) {
      const { w } = slot(windowS);
      if (o.redis) {
        try {
          return Number((await o.redis.get(`${PREFIX}${key}:${w}`)) ?? 0);
        } catch {
          // rơi xuống đếm trong tiến trình
        }
      }
      return mem(key, windowS, 0);
    },
  };
}
