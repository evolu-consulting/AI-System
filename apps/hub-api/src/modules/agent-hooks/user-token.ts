// dlc-dify · access token AI-System của MỘT user cho hook / gọi KH thay user: xin admin-api `POST /internal/tokens`
// (Bearer `HUB_INTERNAL_TOKEN`), giữ trong bộ nhớ tới trước hết hạn 120 s. Không log token. Vắng cấu hình ⇒ null (hook vẫn
// chạy, workflow nhận `user_token` rỗng).
import type { Logger } from "../../lib/logger";

export type UserTokens = { forUser(tenantId: string, userId: string): Promise<string | null> };

type Cached = { token: string; until: number };
const SKEW_MS = 120_000;
const MAX_ENTRIES = 500;

export function userTokens(d: {
  adminUrl?: string;
  internalToken?: string;
  log: Pick<Logger, "warn">;
  fetch?: typeof fetch;
  now?: () => number;
}): UserTokens {
  const cache = new Map<string, Cached>();
  const now = d.now ?? Date.now;
  const f = d.fetch ?? globalThis.fetch;
  return {
    async forUser(tenantId, userId) {
      if (!d.adminUrl || !d.internalToken) return null;
      const key = `${tenantId}:${userId}`;
      const hit = cache.get(key);
      if (hit && hit.until > now()) return hit.token;
      try {
        const res = await f(`${d.adminUrl.replace(/\/$/, "")}/internal/tokens`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${d.internalToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tenant_id: tenantId, user_id: userId }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          d.log.warn("hook-user-token-failed", { status: res.status });
          return null;
        }
        const b = (await res.json()) as { access_token?: string; expires_in?: number };
        if (!b.access_token) return null;
        if (cache.size >= MAX_ENTRIES) cache.clear();
        cache.set(key, {
          token: b.access_token,
          until: now() + Math.max(0, (b.expires_in ?? 900) * 1000 - SKEW_MS),
        });
        return b.access_token;
      } catch (err) {
        d.log.warn("hook-user-token-failed", { error: (err as Error).name });
        return null;
      }
    },
  };
}
