// sso-switch · kho mã chuyển phiên (một lần, 60 giây). Khoá = SHA-256 của mã (mã thô không nằm trong kho).
// Production: Redis (`SET … PX` + `GETDEL` nguyên tử ⇒ hai request cùng mã chỉ một bên lấy được). Không Redis (dev/test
// in-process): Map trong bộ nhớ của tiến trình — cùng ngữ nghĩa lấy-là-xoá.
import type { WebApp } from "@ai/contracts";
import type { Redis } from "../../../lib/redis";

export type SsoEntry = {
  tid: string;
  sub: string;
  /** family_id phiên nguồn (claim `sid`): phiên nguồn đã đăng xuất/thu hồi ⇒ mã vô hiệu. */
  sid: string;
  app: WebApp;
  /** Hết hạn theo đồng hồ của app (ms) — kiểm khi đổi mã; TTL kho chỉ để dọn rác. */
  exp: number;
};

export type SsoCodeStore = {
  put(key: string, e: SsoEntry, ttlMs: number): Promise<void>;
  /** Lấy và xoá trong một bước; không có ⇒ null. */
  take(key: string): Promise<SsoEntry | null>;
};

export function memorySsoStore(): SsoCodeStore {
  const m = new Map<string, { e: SsoEntry; until: number }>();
  const sweep = () => {
    const t = Date.now();
    for (const [k, v] of m) if (v.until <= t) m.delete(k);
  };
  return {
    async put(key, e, ttlMs) {
      sweep();
      m.set(key, { e, until: Date.now() + ttlMs });
    },
    async take(key) {
      const v = m.get(key);
      m.delete(key);
      return v && v.until > Date.now() ? v.e : null;
    },
  };
}

const PREFIX = "admin:sso:";

export function redisSsoStore(redis: Redis): SsoCodeStore {
  return {
    async put(key, e, ttlMs) {
      await redis.set(PREFIX + key, JSON.stringify(e), "PX", ttlMs);
    },
    async take(key) {
      const raw = await redis.getdel(PREFIX + key);
      return raw ? (JSON.parse(raw) as SsoEntry) : null;
    },
  };
}
